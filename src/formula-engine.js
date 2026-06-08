const TOKEN_TYPES = {
  NUMBER: 'NUMBER',
  FIELD_REF: 'FIELD_REF',
  PLUS: 'PLUS',
  MINUS: 'MINUS',
  STAR: 'STAR',
  SLASH: 'SLASH',
  LPAREN: 'LPAREN',
  RPAREN: 'RPAREN',
  COMMA: 'COMMA',
  FUNCTION: 'FUNCTION',
  COMPARE_OP: 'COMPARE_OP',
  EOF: 'EOF'
};

const BUILTIN_FUNCTIONS = {
  ABS: { minArgs: 1, maxArgs: 1 },
  ROUND: { minArgs: 1, maxArgs: 2 },
  MAX: { minArgs: 1, maxArgs: 2 },
  MIN: { minArgs: 1, maxArgs: 2 },
  IF: { minArgs: 3, maxArgs: 3 }
};

class Token {
  constructor(type, value, pos) {
    this.type = type;
    this.value = value;
    this.pos = pos;
  }
}

class Lexer {
  constructor(input) {
    this.input = input;
    this.pos = 0;
    this.tokens = [];
    this.errors = [];
    this.tokenize();
  }

  peek() {
    return this.pos < this.input.length ? this.input[this.pos] : null;
  }

  advance() {
    const ch = this.input[this.pos];
    this.pos++;
    return ch;
  }

  tokenize() {
    while (this.pos < this.input.length) {
      const ch = this.peek();

      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        this.advance();
        continue;
      }

      if (ch === '[') {
        this.readFieldRef();
        continue;
      }

      if ((ch >= '0' && ch <= '9') || (ch === '.' && this.pos + 1 < this.input.length && this.input[this.pos + 1] >= '0' && this.input[this.pos + 1] <= '9')) {
        this.readNumber();
        continue;
      }

      if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_') {
        this.readIdentifier();
        continue;
      }

      const startPos = this.pos;
      switch (ch) {
        case '+': this.tokens.push(new Token(TOKEN_TYPES.PLUS, '+', startPos)); this.advance(); break;
        case '-': this.tokens.push(new Token(TOKEN_TYPES.MINUS, '-', startPos)); this.advance(); break;
        case '*': this.tokens.push(new Token(TOKEN_TYPES.STAR, '*', startPos)); this.advance(); break;
        case '/': this.tokens.push(new Token(TOKEN_TYPES.SLASH, '/', startPos)); this.advance(); break;
        case '(': this.tokens.push(new Token(TOKEN_TYPES.LPAREN, '(', startPos)); this.advance(); break;
        case ')': this.tokens.push(new Token(TOKEN_TYPES.RPAREN, ')', startPos)); this.advance(); break;
        case ',': this.tokens.push(new Token(TOKEN_TYPES.COMMA, ',', startPos)); this.advance(); break;
        case '>':
          this.advance();
          if (this.peek() === '=') { this.tokens.push(new Token(TOKEN_TYPES.COMPARE_OP, '>=', startPos)); this.advance(); }
          else { this.tokens.push(new Token(TOKEN_TYPES.COMPARE_OP, '>', startPos)); }
          break;
        case '<':
          this.advance();
          if (this.peek() === '=') { this.tokens.push(new Token(TOKEN_TYPES.COMPARE_OP, '<=', startPos)); this.advance(); }
          else { this.tokens.push(new Token(TOKEN_TYPES.COMPARE_OP, '<', startPos)); }
          break;
        case '=':
          this.advance();
          if (this.peek() === '=') { this.tokens.push(new Token(TOKEN_TYPES.COMPARE_OP, '==', startPos)); this.advance(); }
          else { this.errors.push({ pos: startPos, message: `位置 ${startPos + 1}: 无效运算符 "="，比较请使用 "=="` }); }
          break;
        case '!':
          this.advance();
          if (this.peek() === '=') { this.tokens.push(new Token(TOKEN_TYPES.COMPARE_OP, '!=', startPos)); this.advance(); }
          else { this.errors.push({ pos: startPos, message: `位置 ${startPos + 1}: 无效字符 "!"` }); }
          break;
        default:
          this.errors.push({ pos: startPos, message: `位置 ${startPos + 1}: 无法识别的字符 "${ch}"` });
          this.advance();
      }
    }
    this.tokens.push(new Token(TOKEN_TYPES.EOF, null, this.pos));
  }

  readFieldRef() {
    const startPos = this.pos;
    this.advance();
    let name = '';
    while (this.pos < this.input.length && this.input[this.pos] !== ']') {
      name += this.input[this.pos];
      this.pos++;
    }
    if (this.pos >= this.input.length) {
      this.errors.push({ pos: startPos, message: `位置 ${startPos + 1}: 字段引用缺少右方括号 "]"` });
      this.tokens.push(new Token(TOKEN_TYPES.FIELD_REF, name, startPos));
      return;
    }
    this.advance();
    if (!name.trim()) {
      this.errors.push({ pos: startPos, message: `位置 ${startPos + 1}: 字段引用不能为空 "[]"` });
    }
    this.tokens.push(new Token(TOKEN_TYPES.FIELD_REF, name, startPos));
  }

  readNumber() {
    const startPos = this.pos;
    let numStr = '';
    let hasDot = false;
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (ch >= '0' && ch <= '9') {
        numStr += ch;
        this.pos++;
      } else if (ch === '.' && !hasDot) {
        hasDot = true;
        numStr += ch;
        this.pos++;
      } else {
        break;
      }
    }
    if (numStr.endsWith('.')) {
      this.errors.push({ pos: this.pos - 1, message: `位置 ${this.pos}: 数字以小数点结尾，不完整` });
    }
    this.tokens.push(new Token(TOKEN_TYPES.NUMBER, parseFloat(numStr), startPos));
  }

  readIdentifier() {
    const startPos = this.pos;
    let name = '';
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch === '_') {
        name += ch;
        this.pos++;
      } else {
        break;
      }
    }
    const upper = name.toUpperCase();
    if (BUILTIN_FUNCTIONS[upper]) {
      this.tokens.push(new Token(TOKEN_TYPES.FUNCTION, upper, startPos));
    } else {
      this.errors.push({ pos: startPos, message: `位置 ${startPos + 1}: 未知的标识符 "${name}"，如果是字段引用请用方括号包裹如 [${name}]` });
      this.tokens.push(new Token(TOKEN_TYPES.FIELD_REF, name, startPos));
    }
  }
}

const NODE_TYPES = {
  NUMBER: 'NUMBER',
  FIELD_REF: 'FIELD_REF',
  BINARY_OP: 'BINARY_OP',
  UNARY_MINUS: 'UNARY_MINUS',
  FUNCTION_CALL: 'FUNCTION_CALL',
  COMPARE: 'COMPARE'
};

class ASTNode {
  constructor(type, data) {
    this.type = type;
    Object.assign(this, data);
  }
}

class Parser {
  constructor(tokens, errors) {
    this.tokens = tokens;
    this.errors = errors || [];
    this.pos = 0;
  }

  current() {
    return this.tokens[this.pos] || new Token(TOKEN_TYPES.EOF, null, 0);
  }

  advance() {
    const tok = this.current();
    this.pos++;
    return tok;
  }

  expect(type) {
    const tok = this.current();
    if (tok.type !== type) {
      this.errors.push({ pos: tok.pos, message: `位置 ${tok.pos + 1}: 期望 ${this.typeLabel(type)}，实际遇到 ${this.typeLabel(tok.type)}${tok.value !== null ? ` "${tok.value}"` : ''}` });
      return null;
    }
    return this.advance();
  }

  typeLabel(type) {
    const labels = {
      [TOKEN_TYPES.NUMBER]: '数字',
      [TOKEN_TYPES.FIELD_REF]: '字段引用',
      [TOKEN_TYPES.PLUS]: '"+"',
      [TOKEN_TYPES.MINUS]: '"-"',
      [TOKEN_TYPES.STAR]: '"*"',
      [TOKEN_TYPES.SLASH]: '"/"',
      [TOKEN_TYPES.LPAREN]: '"("',
      [TOKEN_TYPES.RPAREN]: '")"',
      [TOKEN_TYPES.COMMA]: '","',
      [TOKEN_TYPES.FUNCTION]: '函数名',
      [TOKEN_TYPES.COMPARE_OP]: '比较运算符',
      [TOKEN_TYPES.EOF]: '表达式结尾'
    };
    return labels[type] || type;
  }

  parse() {
    const ast = this.parseExpression();
    if (this.current().type !== TOKEN_TYPES.EOF) {
      const tok = this.current();
      this.errors.push({ pos: tok.pos, message: `位置 ${tok.pos + 1}: 多余的内容 "${tok.value}"` });
    }
    return ast;
  }

  parseExpression() {
    return this.parseComparison();
  }

  parseComparison() {
    let left = this.parseAdditive();
    while (this.current().type === TOKEN_TYPES.COMPARE_OP) {
      const opTok = this.advance();
      const right = this.parseAdditive();
      left = new ASTNode(NODE_TYPES.COMPARE, { operator: opTok.value, left, right });
    }
    return left;
  }

  parseAdditive() {
    let left = this.parseMultiplicative();
    while (this.current().type === TOKEN_TYPES.PLUS || this.current().type === TOKEN_TYPES.MINUS) {
      const opTok = this.advance();
      const right = this.parseMultiplicative();
      left = new ASTNode(NODE_TYPES.BINARY_OP, { operator: opTok.value, left, right });
    }
    return left;
  }

  parseMultiplicative() {
    let left = this.parseUnary();
    while (this.current().type === TOKEN_TYPES.STAR || this.current().type === TOKEN_TYPES.SLASH) {
      const opTok = this.advance();
      const right = this.parseUnary();
      left = new ASTNode(NODE_TYPES.BINARY_OP, { operator: opTok.value, left, right });
    }
    return left;
  }

  parseUnary() {
    if (this.current().type === TOKEN_TYPES.MINUS) {
      const tok = this.advance();
      const operand = this.parsePrimary();
      return new ASTNode(NODE_TYPES.UNARY_MINUS, { operand, pos: tok.pos });
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const tok = this.current();

    if (tok.type === TOKEN_TYPES.NUMBER) {
      this.advance();
      return new ASTNode(NODE_TYPES.NUMBER, { value: tok.value });
    }

    if (tok.type === TOKEN_TYPES.FIELD_REF) {
      this.advance();
      return new ASTNode(NODE_TYPES.FIELD_REF, { name: tok.value });
    }

    if (tok.type === TOKEN_TYPES.FUNCTION) {
      return this.parseFunctionCall();
    }

    if (tok.type === TOKEN_TYPES.LPAREN) {
      this.advance();
      const expr = this.parseExpression();
      this.expect(TOKEN_TYPES.RPAREN);
      return expr;
    }

    this.errors.push({ pos: tok.pos, message: `位置 ${tok.pos + 1}: 意外的符号${tok.value !== null ? ` "${tok.value}"` : ''}` });
    this.advance();
    return new ASTNode(NODE_TYPES.NUMBER, { value: 0 });
  }

  parseFunctionCall() {
    const funcTok = this.advance();
    const funcName = funcTok.value;
    const funcDef = BUILTIN_FUNCTIONS[funcName];

    const lparen = this.expect(TOKEN_TYPES.LPAREN);
    if (!lparen) return new ASTNode(NODE_TYPES.NUMBER, { value: 0 });

    const args = [];
    if (this.current().type !== TOKEN_TYPES.RPAREN) {
      args.push(this.parseExpression());
      while (this.current().type === TOKEN_TYPES.COMMA) {
        this.advance();
        args.push(this.parseExpression());
      }
    }

    const rparen = this.expect(TOKEN_TYPES.RPAREN);
    if (!rparen) return new ASTNode(NODE_TYPES.NUMBER, { value: 0 });

    if (funcDef) {
      if (args.length < funcDef.minArgs) {
        this.errors.push({ pos: funcTok.pos, message: `函数 ${funcName}() 至少需要 ${funcDef.minArgs} 个参数，实际传入了 ${args.length} 个` });
      } else if (args.length > funcDef.maxArgs) {
        this.errors.push({ pos: funcTok.pos, message: `函数 ${funcName}() 最多接受 ${funcDef.maxArgs} 个参数，实际传入了 ${args.length} 个` });
      }
    }

    return new ASTNode(NODE_TYPES.FUNCTION_CALL, { name: funcName, args });
  }
}

class FormulaEvaluator {
  evaluate(ast, fieldValueGetter) {
    try {
      return this.evalNode(ast, fieldValueGetter);
    } catch (e) {
      if (e.message === 'ERR') return 'ERR';
      return 'ERR';
    }
  }

  evalNode(node, fieldValueGetter) {
    switch (node.type) {
      case NODE_TYPES.NUMBER:
        return node.value;

      case NODE_TYPES.FIELD_REF: {
        const val = fieldValueGetter(node.name);
        if (val === undefined || val === null) {
          throw new Error('ERR');
        }
        return val;
      }

      case NODE_TYPES.UNARY_MINUS: {
        const val = this.evalNode(node.operand, fieldValueGetter);
        if (typeof val !== 'number') throw new Error('ERR');
        return -val;
      }

      case NODE_TYPES.BINARY_OP: {
        const left = this.evalNode(node.left, fieldValueGetter);
        const right = this.evalNode(node.right, fieldValueGetter);
        if (typeof left !== 'number' || typeof right !== 'number') throw new Error('ERR');
        switch (node.operator) {
          case '+': return left + right;
          case '-': return left - right;
          case '*': return left * right;
          case '/':
            if (right === 0) throw new Error('ERR');
            return left / right;
          default: throw new Error('ERR');
        }
      }

      case NODE_TYPES.COMPARE: {
        const left = this.evalNode(node.left, fieldValueGetter);
        const right = this.evalNode(node.right, fieldValueGetter);
        if (typeof left !== 'number' || typeof right !== 'number') throw new Error('ERR');
        switch (node.operator) {
          case '>': return left > right ? 1 : 0;
          case '<': return left < right ? 1 : 0;
          case '>=': return left >= right ? 1 : 0;
          case '<=': return left <= right ? 1 : 0;
          case '==': return left === right ? 1 : 0;
          case '!=': return left !== right ? 1 : 0;
          default: throw new Error('ERR');
        }
      }

      case NODE_TYPES.FUNCTION_CALL: {
        const argValues = node.args.map(a => this.evalNode(a, fieldValueGetter));
        switch (node.name) {
          case 'ABS': {
            if (typeof argValues[0] !== 'number') throw new Error('ERR');
            return Math.abs(argValues[0]);
          }
          case 'ROUND': {
            if (typeof argValues[0] !== 'number') throw new Error('ERR');
            const decimals = argValues.length > 1 ? (typeof argValues[1] === 'number' ? argValues[1] : 0) : 0;
            const factor = Math.pow(10, decimals);
            return Math.round(argValues[0] * factor) / factor;
          }
          case 'MAX': {
            const a = argValues[0], b = argValues[1] !== undefined ? argValues[1] : a;
            if (typeof a !== 'number' || typeof b !== 'number') throw new Error('ERR');
            return Math.max(a, b);
          }
          case 'MIN': {
            const a2 = argValues[0], b2 = argValues[1] !== undefined ? argValues[1] : a2;
            if (typeof a2 !== 'number' || typeof b2 !== 'number') throw new Error('ERR');
            return Math.min(a2, b2);
          }
          case 'IF': {
            const condition = argValues[0];
            const trueVal = argValues[1];
            const falseVal = argValues[2];
            if (condition) return trueVal;
            return falseVal;
          }
          default:
            throw new Error('ERR');
        }
      }

      default:
        throw new Error('ERR');
    }
  }
}

export function validateFormula(formula, validFieldNames) {
  if (!formula || !formula.trim()) {
    return { valid: false, errors: [{ pos: 0, message: '公式不能为空' }] };
  }

  const lexer = new Lexer(formula);
  const errors = [...lexer.errors];

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const parser = new Parser(lexer.tokens, errors);
  parser.parse();

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const fieldRefs = collectFieldRefs(lexer.tokens);
  const unknownFields = fieldRefs.filter(ref => !validFieldNames.includes(ref));
  unknownFields.forEach(ref => {
    const tok = lexer.tokens.find(t => t.type === TOKEN_TYPES.FIELD_REF && t.value === ref);
    errors.push({
      pos: tok ? tok.pos : 0,
      message: `字段引用 [${ref}] 不存在于可用值字段中`
    });
  });

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [] };
}

function collectFieldRefs(tokens) {
  const refs = [];
  const seen = new Set();
  tokens.forEach(tok => {
    if (tok.type === TOKEN_TYPES.FIELD_REF && tok.value && !seen.has(tok.value)) {
      seen.add(tok.value);
      refs.push(tok.value);
    }
  });
  return refs;
}

export function getFormulaFieldRefs(formula) {
  if (!formula || !formula.trim()) return [];
  const lexer = new Lexer(formula);
  return collectFieldRefs(lexer.tokens);
}

export function evaluateFormula(formula, fieldValueGetter) {
  if (!formula || !formula.trim()) return 'ERR';

  const lexer = new Lexer(formula);
  if (lexer.errors.length > 0) return 'ERR';

  const parser = new Parser(lexer.tokens);
  const ast = parser.parse();
  if (parser.errors.length > 0) return 'ERR';

  const evaluator = new FormulaEvaluator();
  return evaluator.evaluate(ast, fieldValueGetter);
}
