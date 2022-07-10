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
	return ('a'.charCodeAt(0) <= c && c <= 'z'.charCodeAt(0)) || c == '_'.charCodeAt(0);
}

export function* tokenize(s: string) {
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
			yield new IntValue(n);
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

interface Token {
	lbp: number
	led(state: ParserState, left: Node): Node
	nud(state: ParserState): Node
}

const enum NodeType { Int, Cond, Op }
type Node = {type: NodeType.Int, value: number} | {type: NodeType.Cond, cond: Condition} | {type: NodeType.Op, op: Operator};

type ParserState = {current: Token, next: Token, tokens: Iterator<Token>};

export function parse(tokens: Iterator<Token,Token>) {
	const state = {current: Eof, next: tokens.next().value, tokens: tokens};
	const node = expression(state, 0);
	if (node.type != NodeType.Op) {
		throw new ParseError('expected comparison or operator');
	}
	return node.op;
}

function expression(state: ParserState, rbp: number) {
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

const Eof = Object.freeze({
	lbp: 0,
	led: (state: ParserState, left: Node): Node => { throw new ParseError('unexpected eof'); },
	nud: (state: ParserState): Node => { throw new ParseError('unexpected eof'); }
});

class CmpOp {
	constructor(readonly lbp: number, readonly opclass: new (cond: Condition, arg: number) => Operator) {}

	led(state: ParserState, left: Node) {
		if (left.type != NodeType.Cond) throw new ParseError('expected condition on left hand side of comparison');
		const right = expression(state, this.lbp);
		if (right.type != NodeType.Int) throw new ParseError('expected number on right hand side of comparison');
		return {type: NodeType.Op, op: new this.opclass(left.cond, right.value)} as Node;
	}

	nud(state: ParserState): Node {
		throw new ParseError('expected expression');
	}
}

class LogicalOp {
	constructor(readonly lbp: number, readonly opclass: new (left: Operator, right: Operator) => Operator) {}

	led(state: ParserState, left: Node) {
		if (left.type != NodeType.Op) throw new ParseError('expected comparison on left hand side of operator');
		const right = expression(state, this.lbp);
		if (right.type != NodeType.Op) throw new ParseError('expected comparison on right hand side of operator');
		return {type: NodeType.Op, op: new this.opclass(left.op, right.op)} as Node;
	}

	nud(state: ParserState): Node {
		throw new ParseError('expected expression');
	}
}

const OperatorEq = Object.freeze(new CmpOp(30, EqOperator));
const OperatorNeq = Object.freeze(new CmpOp(30, NeqOperator));
const OperatorLt = Object.freeze(new CmpOp(30, LtOperator));
const OperatorLte = Object.freeze(new CmpOp(30, LteOperator));
const OperatorGt = Object.freeze(new CmpOp(30, GtOperator));
const OperatorGte = Object.freeze(new CmpOp(30, GteOperator));

const OperatorAnd = Object.freeze(new LogicalOp(20, AndOperator));

const OperatorOr = Object.freeze(new LogicalOp(10, OrOperator));

class IntValue implements Token {
	lbp = 0
	value: number

	constructor(value: number) {
		this.value = value;
	}

	led(state: ParserState, left: Node): Node {
		throw new ParseError('unexpected integer literal');
	}

	nud(state: ParserState) {
		return {type: NodeType.Int, value: this.value} as Node;
	}
}

class Identifier implements Token {
	lbp = 0
	value: string

	constructor(value: string) {
		this.value = value;
	}

	led(state: ParserState, left: Node): Node {
		throw new ParseError('unexpected identifier');
	}

	nud(state: ParserState) {
		return {type: NodeType.Cond, cond: Conditions[this.value as keyof Condition]} as Node;
	}
}

/*import { CourseData, Surface } from './CourseData';
import { Aptitude, Strategy, HorseParameters } from './Types';
import { RegionList, Region } from './ActivationConditions';

const hansin2200: CourseData = {
    distance: 2200,
    surface: Surface.Turf,
    corners: [{start:520,length:190},{start:710,length:190},{start:1250,length:300},{start:1550,length:300}],
    straights: [{start:0,end:520},{start:900,end:1250},{start:1850,end:2200}],
    slopes: [{start:0,length:290,slope:-10000},{start:295,length:125,slope:20000},{start:1400,length:595,slope:-10000},{start:2000,length:125,slope:20000}]
};

const uma: HorseParameters = {
    speed: 1200*1.04*1.2,
    stamina: 800*1.04,
    power: 1100*1.04,
    guts: 1100*1.04,
    int: 1100*1.04,
    strategy: Strategy.Sasi,
    distanceAptitude: Aptitude.S,
    surfaceAptitude: Aptitude.A,
    accelSkillModifier: () => 0
};

import tracks from '../course_data.json';

//const full = new RegionList();
//full.push(new Region(0, hansin2200.distance));
//distance_rate>=60&slope==2&phase==1&order_rate>=40&order_rate<=80&remain_distance>=500
const node = parse(tokenize('distance_rate>=60&slope==2&phase==1&order_rate>=40&order_rate<=80&remain_distance>=500'));
if (node.type == NodeType.Op) {
	for (var trackId in tracks) {
		for (var courseId in tracks[trackId].courses) {
			const course = tracks[trackId].courses[courseId];
			const full = new RegionList();
			full.push(new Region(0, course.distance));
			const regions = node.op.apply(full, course, uma);
			const activationPoint = node.op.samplePolicy.sample(regions);
			console.log(tracks[trackId].name + ' ' + course.name + ': ' + activationPoint);
		}
	}
	//const regions = node.op.apply(full, hansin2200, uma);
	//console.log(regions);
	//console.log(node.op.samplePolicy.sample(regions));
}*/
