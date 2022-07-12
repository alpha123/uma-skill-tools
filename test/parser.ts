import * as fc from 'fast-check';
import { prop, forAll } from './TestHelpers';

import { 
	Operator, CmpOperator, EqOperator, NeqOperator, LtOperator, LteOperator, GtOperator, GteOperator, AndOperator, OrOperator,
	Conditions
} from '../ActivationConditions';
import { parse, tokenize } from '../ConditionParser';

function pick<T>(array: T[]) {
	return fc.mapToConstant({
		num: array.length,
		build: n => array[n]
	})
}

const enum AstNodeType { Cmp, Op }
type OpNode = {type: AstNodeType.Op, op: '&' | '@', left: AstNode, right: AstNode};
type CmpNode = {type: AstNodeType.Cmp, cmp: '==' | '!=' | '>' | '<' | '>=' | '<=', cond: keyof typeof Conditions, value: number};
type AstNode = OpNode | CmpNode;

// There are no parenthesis in the condition grammar (or any other way of grouping operations) and all operators are left-associative,
// so & is constrained to have either & or a comparison on its LHS and a comparison on its RHS. @ must have an @, &, or comparison LHS
// and & or comparison RHS.
const conditionTree = fc.letrec(tie => ({
	node: fc.oneof({depthSize: 'small', withCrossShrink: true}, tie('cmp'), tie('and'), tie('or')),
	and: fc.record({
		type: fc.constant(AstNodeType.Op),
		op: fc.constant('&'),
		left: fc.oneof({depthSize: 'small', withCrossShrink: true}, tie('cmp'), tie('and')),
		right: tie('cmp')
	}),
	or: fc.record({
		type: fc.constant(AstNodeType.Op),
		op: fc.constant('@'),
		left: tie('node'),
		right: fc.oneof({depthSize: 'small', withCrossShrink: true}, tie('cmp'), tie('and'))
	}),
	cmp: fc.record({
		type: fc.constant(AstNodeType.Cmp),
		cmp: pick(['==', '!=', '>', '<', '>=', '<=']),
		cond: pick(Object.keys(Conditions)),
		value: fc.nat()
	})
})).node as fc.Arbitrary<AstNode>;

function stringify(node: AstNode) {
	if (node.type == AstNodeType.Op) {
		return stringify(node.left) + node.op + stringify(node.right);
	} else {
		return node.cond + node.cmp + node.value;
	}
}

function cmpEq(node: CmpNode, op: CmpOperator) {
	return op.condition === Conditions[node.cond] && op.argument == node.value;
}

function treeEqual(node: AstNode, op: Operator) {
	if (node.type == AstNodeType.Cmp) {
		switch (node.cmp) {
		case '==': return op instanceof EqOperator && cmpEq(node, op);
		case '!=': return op instanceof NeqOperator && cmpEq(node, op);
		case '>': return op instanceof GtOperator && cmpEq(node, op);
		case '<': return op instanceof LtOperator && cmpEq(node, op);
		case '>=': return op instanceof GteOperator && cmpEq(node, op);
		case '<=': return op instanceof LteOperator && cmpEq(node, op);
		}
	} else {
		switch (node.op) {
		case '&': return op instanceof AndOperator && treeEqual(node.left, op.left) && treeEqual(node.right, op.right);
		case '@': return op instanceof OrOperator && treeEqual(node.left, op.left) && treeEqual(node.right, op.right);
		}
	}
}

prop('stringify and parse a tree should result in the same tree', forAll(conditionTree, ast => {
	return treeEqual(ast, parse(tokenize(stringify(ast))));
}));
