const path = require('path');
const webpack = require('webpack');
const { RawSource } = require('webpack-sources');
const { createElement } = require('rax');
const { renderToString } = require('rax-server-renderer');
const { handleWebpackErr } = require('rax-compile-config');

const getSSRBaseConfig = require('../config/ssr/getBase');

const PLUGIN_NAME = 'UniversalDocumentPlugin';
const TEMP_FLIE_NAME = '_document.js';

module.exports = class UniversalDocumentPlugin {
  constructor(options) {
    if (!options.path) {
      throw new Error('Please specify document file location with the path attribute');
    }

    if (options.context) {
      this.context = options.context;
    }

    // [{ entryName: 'index', path: '/' }]
    this.pages = options.pages;

    // for internal weex publish
    if (options.publicPath) {
      this.publicPath = options.publicPath;
    }

    this.documentPath = options.path;

    // Disable doctype in `build.json`
    this.doctype = options.doctype === null ? '' : `${options.doctype || '<!DOCTYPE html>'}`;
  }

  apply(compiler) {
    const config = compiler.options;
    const absoluteDocumentPath = path.resolve(config.context, this.documentPath);
    const publicPath = this.publicPath ? this.publicPath : config.output.publicPath;

    // Get output dir from filename instead of hard code.
    const outputFileName = compiler.options.output.filename;
    const outputFilePrefix = getPathInfoFromFileName(outputFileName);

    const documentWebpackConfig = getWebpackConfigForDocument(this.context, {
      entry: absoluteDocumentPath,
      outputPath: config.output.path,
      alias: config.resolve ? config.resolve.alias : {}, // sync the alias, eg. react, react-dom
    });

    let fileDependencies = [];
    let documentContent;

    // Executed while initializing the compilation, right before emitting the compilation event.
    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation) => {
      // Add file dependencies of child compiler to parent compilerto keep them watched
      compilation.hooks.additionalChunkAssets.tap(PLUGIN_NAME, () => {
        const childCompilerDependencies = fileDependencies;

        childCompilerDependencies.forEach(fileDependency => {
          compilation.compilationDependencies.add(fileDependency);
        });
      });
    });

    // Executed before finishing the compilation.
    compiler.hooks.make.tapAsync(PLUGIN_NAME, (mainCompilation, callback) => {
      const childCompiler = webpack(documentWebpackConfig);
      childCompiler.parentCompilation = mainCompilation;

      // Run as child to get child compilation
      childCompiler.runAsChild((err, entries, childCompilation) => {
        if (err) {
          handleWebpackErr(err);
        } else {
          fileDependencies = childCompilation.fileDependencies;
          documentContent = childCompilation.assets[TEMP_FLIE_NAME].source();
        }

        callback();
      });
    });

    // Render into index.html
    compiler.hooks.emit.tapAsync(PLUGIN_NAME, (compilation, callback) => {
      const Document = loadDocument(documentContent);

      this.pages.forEach(page => {
        const { entryName, path } = page;
        const files = compilation.entrypoints.get(entryName).getFiles();
        const assets = getAssetsForPage(files, publicPath);

        const DocumentContextProvider = function() { };
        DocumentContextProvider.prototype.getChildContext = function() {
          return {
            __styles: assets.styles,
            __scripts: assets.scripts,
            __pagePath: path,
          };
        };
        DocumentContextProvider.prototype.render = function() {
          return createElement(Document);
        };

        const DocumentContextProviderElement = createElement(DocumentContextProvider);

        // get document html string
        const pageSource = `${this.doctype}${renderToString(DocumentContextProviderElement)}`;

        // insert html file
        compilation.assets[`${outputFilePrefix}${entryName}.html`] = new RawSource(pageSource);

        delete compilation.assets[TEMP_FLIE_NAME];
      });

      callback();
    });
  }
};

/**
 * Get path info from the output filename
 * 'web/[name].js' => 'web/'
 * '[name].js' => ''
 * @param {*} fileName webpack output file name
 */
function getPathInfoFromFileName(fileName) {
  const paths = fileName.split('/');
  paths.pop();
  return paths.length ? paths.join('/') + '/' : '';
}

/**
 * custom webpack config for document
 * @param {*} context build plugin context
 * @param {*} options defalut config for webpack
 */
function getWebpackConfigForDocument(context, options) {
  const { entry, outputPath, alias } = options;
  const webpackChainConfig = getSSRBaseConfig(context);

  webpackChainConfig
    .entry('document')
    .add(entry);

  webpackChainConfig.output
    .path(outputPath)
    .filename(TEMP_FLIE_NAME);

  webpackChainConfig.externals({
    rax: 'rax',
  });

  Object.keys(alias).forEach((key) => {
    webpackChainConfig.resolve.alias.set(key, alias[key]);
  });

  const documentWebpackConfig = webpackChainConfig.toConfig();

  return documentWebpackConfig;
}

function interopRequire(obj) {
  return obj && obj.__esModule ? obj.default : obj;
}

/**
 * load Document after webpack compilation
 * @param {*} content document output
 */
function loadDocument(content) {
  const tempFn = new Function('require', 'module', content); // eslint-disable-line
  const tempModule = { exports: {} };
  tempFn(require, tempModule);

  if (Object.keys(tempModule.exports).length === 0) {
    throw new Error('Please make sure exports document component!');
  }

  const Document = interopRequire(tempModule.exports);

  return Document;
}

/**
 * get assets from webpack outputs
 * @param {*} files [ 'web/detail.css', 'web/detail.js' ]
 * @param {*} publicPath
 */
function getAssetsForPage(files, publicPath) {
  const jsFiles = files.filter(v => /\.js$/i.test(v));
  const cssFiles = files.filter(v => /\.css$/i.test(v));

  return {
    // Support publicPath use relative path.
    // Change MPA 'pageName/index.js' to 'index.js', when use relative path.
    scripts: jsFiles.map(script => publicPath + (publicPath.startsWith('.') ? path.basename(script) : script)),
    styles: cssFiles.map(style => publicPath + (publicPath.startsWith('.') ? path.basename(style) : style)),
  };
}
