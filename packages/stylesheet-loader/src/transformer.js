

import camelCase from 'camelcase';
import chalk from 'chalk';
import normalizeColor from './normalizeColor';
import particular from './particular';
import Validation from './Validation';
import { pushErrorMessage } from './promptMessage';

const QUOTES_REG = /[\\'|\\"]/g;

const COLOR_PROPERTIES = {
  color: true,
  backgroundColor: true,
  borderColor: true,
  borderBottomColor: true,
  borderTopColor: true,
  borderRightColor: true,
  borderLeftColor: true,
};

export default {
  sanitizeSelector(selector, transformDescendantCombinator = false, position = { start: { line: 0, column: 0 } }, log = false) {
    // tag selector suffix @
    if (/^[a-zA-Z]/.test(selector)) {
      selector = `@${  selector}`;
    }
    // filter multiple extend selectors
    if (log && !transformDescendantCombinator && !/^[.|@|#][a-zA-Z0-9_:-]+$/.test(selector)) {
      const message = `line: ${position.start.line}, column: ${position.start.column} - "${selector}" is not a valid selector (e.g. ".abc、.abcBcd、.abc_bcd")`;
      console.error(chalk.red.bold(message));
      pushErrorMessage(message);
      return null;
    }

    return selector.replace(/\s/gi, '_').replace(/[.]/g, '');
  },

  convertProp(prop) {
    let result = camelCase(prop);

    // Handle vendor prefixes
    if (prop.indexOf('-webkit') === 0) {
      result = result.replace('webkit', 'Webkit');
    } else if (prop.indexOf('-moz') === 0) {
      result = result.replace('moz', 'Moz');
    }

    return result;
  },

  convertValue(property, value) {
    let result = value;
    let resultNumber;

    if (!Number.isNaN(Number(result))) {
      result = Number(result);
    }

    if (COLOR_PROPERTIES[property]) {
      result = normalizeColor(value);
    }

    return result;
  },

  convert(rule, log) {
    const style = {};

    if (rule.tagName === 'text') {
      return;
    }

    rule.declarations.forEach((declaration) => {
      if (declaration.type !== 'declaration') {
        return;
      }
      declaration.value = declaration.value.replace(QUOTES_REG, '');
      const camelCaseProperty = this.convertProp(declaration.property);
      const value = this.convertValue(camelCaseProperty, declaration.value);
      style[camelCaseProperty] = value;

      Validation.validate(camelCaseProperty, declaration.property, declaration.value, rule.selectors.join(', '), declaration.position, log);
      if (particular[camelCaseProperty]) {
        const particularResult = particular[camelCaseProperty](value);
        if (particularResult.isDeleted) {
          style[camelCaseProperty] = null;
          delete style[camelCaseProperty];
          delete particularResult.isDeleted;
        }
        Object.assign(style, particularResult);
      }
    });

    return style;
  },
};
