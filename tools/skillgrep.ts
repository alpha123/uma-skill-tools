const assert = require('assert').strict;

import { program, Option } from 'commander';

import { parseAny, parse, tokenize, Node, NodeType } from '../ConditionParser';
import {
	Operator, CmpOperator, EqOperator, NeqOperator, LtOperator, LteOperator, GtOperator, GteOperator, AndOperator, OrOperator,
	Condition
} from '../ActivationConditions';

import skills from '../data/skill_data.json';
import skillnames from '../data/skillnames.json';

program
	.argument('<condition>', 'Condition to search for. May be a condition name (e.g. blocked_side_continuetime), an expression (corner==0&order_rate<80), or, if --name is specified, a skill name.')
	.option('-P, --pre', 'search only preconditions')
	.option('-X, --exclude-pre', 'do not search preconditions')
	.option('-N, --name', 'search skill names instead of conditions')
	.option('-l, --list', 'print skill names/ids only (default: also print conditions)')
	.option('-d, --id', 'show skill IDs instead of names')
	.addOption(new Option('--lang <language>', 'language for printing skill names').choices(['jp', 'en']).default('jp'))
	.action((condition, options) => {
		options.condition = condition;
	});

program.parse();
const opts = program.opts();

function isCmpOperator(tree: Operator): tree is CmpOperator {
	return 'condition' in tree;
}

function assertIsCmpOperator(tree: Operator): asserts tree is CmpOperator {
	assert(isCmpOperator(tree));
}

function assertIsLogicalOp(tree: Operator): asserts tree is AndOperator | OrOperator {
	assert('left' in tree && 'right' in tree);
}

function flatten(node: AndOperator, conds: CmpOperator[]) {
	// due to the grammar the right branch of an & must be a comparison
	// (there are no parenthesis to override precedence and & is left-associative)
	assertIsCmpOperator(node.right);
	conds.push(node.right);
	if (node.left instanceof AndOperator) {
		return flatten(node.left, conds);
	}
	// if it's not an & it must be a comparison, since @ has a lower precedence
	assertIsCmpOperator(node.left);
	conds.push(node.left);
	return conds;
}

function condMatcher(cond: Condition | CmpOperator, node: Operator) {
	if (isCmpOperator(node)) {
		if ('argument' in cond) {
			return node.condition === cond.condition && node.argument == cond.argument
			    && Object.getPrototypeOf(cond) === Object.getPrototypeOf(node);  // match operator type (gt, eq, etc)
		} else {
			return node.condition === cond;
		}
	}
	assertIsLogicalOp(node);
	return condMatcher(cond, node.left) || condMatcher(cond, node.right);
}

function andMatcher(conds: CmpOperator[], node: Operator) {
	if (node instanceof OrOperator) {
		const conds2 = conds.slice();  // gets destructively modified
		return andMatcher(conds, node.left) || andMatcher(conds2, node.right);
	} else if (node instanceof AndOperator) {
		assertIsCmpOperator(node.right);
		const idx = conds.findIndex(c => condMatcher(c, node.right));
		if (idx != -1) {
			conds.splice(idx,1);
		}
		return conds.length == 0 || andMatcher(conds, node.left);
	} else {
		assertIsCmpOperator(node);
		return conds.length == 1 && condMatcher(conds[0], node);
	}
}

function treeMatch(match: Node, tree: Operator) {
	switch (match.type) {
	case NodeType.Op:
		if (match.op instanceof AndOperator) {
			return andMatcher(flatten(match.op, []), tree);
		} else if (isCmpOperator(match.op)) {
			return condMatcher(match.op, tree);
		} else {
			throw new Error('doesn\'t support @ in search conditions');
		}
	case NodeType.Cond:
		return condMatcher(match.cond, tree);
		break;
	case NodeType.Int:
		throw new Error('doesn\'t support sole integer as search condition');
	}
}

const mockSamplePolicy = Object.freeze({
	sample(_0,_1) { assert(false); },
	reconcile(_) { return this; },
	reconcileAsap(_) { return this; },
	reconcileLogNormalRandom(_) { return this; },
	reconcileRandom(_) { return this; },
	reconcileStraightRandom(_) { return this; },
	reconcileAllCornerRandom(_) { return this; }
});
const mockConditions = new Proxy({}, {
	get(cache: object, prop: string) {
		if (cache.hasOwnProperty(prop)) {
			return cache[prop];  // cache to allow identity comparison
		}
		return cache[prop] = {name: prop, samplePolicy: mockSamplePolicy};
	}
});

const match = opts.name ? opts.condition.toUpperCase() : parseAny(tokenize(opts.condition), {conditions: mockConditions});

for (const id in skills) {
	if (id[0] == '9') continue;
	let logged = false;
	skills[id].alternatives.forEach(ef => {
		if (
		   opts.name ? skillnames[id].find(s => s.toUpperCase().indexOf(match) > -1)
		 : (!opts.excludePre && ef.precondition.length > 0 && treeMatch(match, parse(tokenize(ef.precondition), {conditions: mockConditions})))
		|| (!opts.pre && ef.condition.length > 0 && treeMatch(match, parse(tokenize(ef.condition), {conditions: mockConditions})))
		) {
			if (!logged) {
				if (opts.id) {
					console.log(id);
				} else {
					console.log(skillnames[id][+(opts.lang == 'en')] + ' ('+id+')');
				}
				logged = true;
			}
			if (!opts.list) {
				if (ef.precondition.length > 0) {
					console.log('Precondition:\t' + ef.precondition)
				}
				console.log('   Condition:\t' + ef.condition);
			}
		}
	});
}
