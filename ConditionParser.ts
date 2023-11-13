import {
	Operator, EqOperator, NeqOperator, LtOperator, LteOperator, GtOperator, GteOperator, AndOperator, OrOperator,
	Condition, Conditions
} from './ActivationConditions';

class ParseError extends Error {
	constructor(msg: string) {
		super(msg);
	}
}

function isId(c: number) {
	return ('a'.charCodeAt(0) <= c && c <= 'z'.charCodeAt(0)) || ('0'.charCodeAt(0) <= c && c <= '9'.charCodeAt(0)) || c == '_'.charCodeAt(0);
}

interface Token<T,U> {
	lbp: number
	led(state: ParserState<T,U>, left: Node<T,U>): Node<T,U>
	nud(state: ParserState<T,U>): Node<T,U>
}

export const enum NodeType { Int, Cond, Op };
export type Node<ConditionT = Condition, OperatorT = Operator> = {type: NodeType.Int, value: number} | {type: NodeType.Cond, cond: ConditionT} | {type: NodeType.Op, op: OperatorT};

type ParserState<T,U> = {current: Token<T,U>, next: Token<T,U>, tokens: Iterator<Token<T,U>>};

class IntValue<T,U> implements Token<T,U> {
	lbp = 0
	value: number

	constructor(value: number) {
		this.value = value;
	}

	led(state: ParserState<T,U>, left: Node<T,U>): Node<T,U> {
		throw new ParseError('unexpected integer literal');
	}

	nud(state: ParserState<T,U>) {
		return {type: NodeType.Int, value: this.value} as Node<T,U>;
	}
}

export function getParser<ConditionT = Condition, OperatorT = Operator>(
	conditions: {[cond: string]: ConditionT} = Conditions as unknown as {[cond: string]: ConditionT},  // as far as i can tell there's really no easy way to get this to work
	operators: {
		and: new (left: OperatorT, right: OperatorT) => OperatorT,
		or: new (left: OperatorT, right: OperatorT) => OperatorT,
		eq: new (cond: ConditionT, arg: number) => OperatorT,
		neq: new (cond: ConditionT, arg: number) => OperatorT,
		lt: new (cond: ConditionT, arg: number) => OperatorT,
		lte: new (cond: ConditionT, arg: number) => OperatorT,
		gt: new (cond: ConditionT, arg: number) => OperatorT,
		gte: new (cond: ConditionT, arg: number) => OperatorT
	} = {
		and: AndOperator as unknown as new (left: OperatorT, right: OperatorT) => OperatorT,  // this is really stupid
		or: OrOperator as unknown as new (left: OperatorT, right: OperatorT) => OperatorT,
		eq: EqOperator as unknown as new (cond: ConditionT, arg: number) => OperatorT,
		neq: NeqOperator as unknown as new (cond: ConditionT, arg: number) => OperatorT,
		lt: LtOperator as unknown as new (cond: ConditionT, arg: number) => OperatorT,
		lte: LteOperator as unknown as new (cond: ConditionT, arg: number) => OperatorT,
		gt: GtOperator as unknown as new (cond: ConditionT, arg: number) => OperatorT,
		gte: GteOperator as unknown as new (cond: ConditionT, arg: number) => OperatorT
	}
) {
	const Eof = Object.freeze({
		lbp: 0,
		led: (state: ParserState<ConditionT,OperatorT>, left: Node<ConditionT,OperatorT>): Node<ConditionT,OperatorT> => { throw new ParseError('unexpected eof'); },
		nud: (state: ParserState<ConditionT,OperatorT>): Node<ConditionT,OperatorT> => { throw new ParseError('unexpected eof'); }
	});

	class Identifier implements Token<ConditionT,OperatorT> {
		lbp = 0
		value: string

		constructor(value: string) {
			this.value = value;
		}

		led(state: ParserState<ConditionT,OperatorT>, left: Node<ConditionT,OperatorT>): Node<ConditionT,OperatorT> {
			throw new ParseError('unexpected identifier');
		}

		nud(state: ParserState<ConditionT,OperatorT>) {
			return {type: NodeType.Cond, cond: conditions[this.value as keyof typeof conditions]} as Node<ConditionT,OperatorT>;
		}
	}

	class CmpOp {
		constructor(readonly lbp: number, readonly opclass: new (cond: ConditionT, arg: number) => OperatorT) {}

		led(state: ParserState<ConditionT,OperatorT>, left: Node<ConditionT,OperatorT>) {
			if (left.type != NodeType.Cond) throw new ParseError('expected condition on left hand side of comparison');
			const right = expression(state, this.lbp);
			if (right.type != NodeType.Int) throw new ParseError('expected number on right hand side of comparison');
			return {type: NodeType.Op, op: new this.opclass(left.cond, right.value)} as Node<ConditionT,OperatorT>;
		}

		nud(state: ParserState<ConditionT,OperatorT>): Node<ConditionT, OperatorT> {
			throw new ParseError('expected expression');
		}
	}

	class LogicalOp {
		constructor(readonly lbp: number, readonly opclass: new (left: OperatorT, right: OperatorT) => OperatorT) {}

		led(state: ParserState<ConditionT, OperatorT>, left: Node<ConditionT, OperatorT>) {
			if (left.type != NodeType.Op) throw new ParseError('expected comparison on left hand side of operator');
			const right = expression(state, this.lbp);
			if (right.type != NodeType.Op) throw new ParseError('expected comparison on right hand side of operator');
			return {type: NodeType.Op, op: new this.opclass(left.op, right.op)} as Node<ConditionT, OperatorT>;
		}

		nud(state: ParserState<ConditionT, OperatorT>): Node<ConditionT, OperatorT> {
			throw new ParseError('expected expression');
		}
	}

	const OperatorEq = Object.freeze(new CmpOp(30, operators.eq));
	const OperatorNeq = Object.freeze(new CmpOp(30, operators.neq));
	const OperatorLt = Object.freeze(new CmpOp(30, operators.lt));
	const OperatorLte = Object.freeze(new CmpOp(30, operators.lte));
	const OperatorGt = Object.freeze(new CmpOp(30, operators.gt));
	const OperatorGte = Object.freeze(new CmpOp(30, operators.gte));

	const OperatorAnd = Object.freeze(new LogicalOp(20, operators.and));

	const OperatorOr = Object.freeze(new LogicalOp(10, operators.or));

	function* tokenize(s: string) {
		var i = 0;
		while (i < s.length) {
			var c = s.charCodeAt(i);
			if ('0'.charCodeAt(0) <= c && c <= '9'.charCodeAt(0)) {
				var n = 0;
				while ('0'.charCodeAt(0) <= c && c <= '9'.charCodeAt(0)) {
					n *= 10;
					n += c - '0'.charCodeAt(0);
					c = s.charCodeAt(++i);
				}
				yield new IntValue<ConditionT,OperatorT>(n);
			} else if (isId(c)) {
				var idstart = i;
				while (isId(c)) {
					c = s.charCodeAt(++i);
				}
				yield new Identifier(s.slice(idstart, i));
			} else switch (s[i]) {
			case '=':
				if (s[++i] != '=') throw new ParseError('expected =');
				++i;
				yield OperatorEq;
				break;
			case '!':
				if (s[++i] != '=') throw new ParseError('expected =');
				++i;
				yield OperatorNeq;
				break;
			case '<':
				if (s[++i] == '=') {
					++i;
					yield OperatorLte;
				} else {
					yield OperatorLt;
				}
				break;
			case '>':
				if (s[++i] == '=') {
					++i;
					yield OperatorGte;
				} else {
					yield OperatorGt;
				}
				break;
			case '@':
				yield OperatorOr;
				++i;
				break;
			case '&':
				yield OperatorAnd;
				++i;
				break;
			default:
				throw new ParseError('invalid character');
			}
		}
		return Eof;
	}

	function parseAny(tokens: Iterator<Token<ConditionT,OperatorT>, Token<ConditionT,OperatorT>>) {
		const state = {current: Eof, next: tokens.next().value, tokens: tokens};
		return expression(state, 0);
	}

	function parse(tokens: Iterator<Token<ConditionT,OperatorT>, Token<ConditionT,OperatorT>>) {
		const node = parseAny(tokens);
		if (node.type != NodeType.Op) {
			throw new ParseError('expected comparison or operator');
		}
		return node.op;
	}

	// top-down operator precedence parser (Pratt parser)
	// the grammar of the condition "language" is quite simple:
	//     Or ::= And '@' Or | And
	//     And ::= Cmp '&' And | Cmp
	//     Cmp ::= condition Op integer
	//     Op ::= '==' | '!=' | '>' | '>=' | '<' | '<='
	// there are no parenthesis nor any other way to control precedence

	function expression(state: ParserState<ConditionT,OperatorT>, rbp: number) {
		state.current = state.next;
		state.next = state.tokens.next().value;
		var left = state.current.nud(state);
		while (rbp < state.next.lbp) {
			state.current = state.next;
			state.next = state.tokens.next().value;
			left = state.current.led(state, left);
		}
		return left;
	}

	return { tokenize, parse, parseAny };
}
