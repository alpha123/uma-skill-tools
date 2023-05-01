const assert = require('assert').strict;

import * as fs from 'fs';
import { program, Option } from 'commander';

import { RaceSolver, SkillType, SkillRarity } from '../RaceSolver';
import { RaceSolverBuilder, GroundCondition, buildBaseStats, buildSkillData } from '../RaceSolverBuilder';
import { Region, RegionList } from '../Region';
import { parse, tokenize } from '../ConditionParser';
import {
	Operator, CmpOperator, EqOperator, NeqOperator, LtOperator, LteOperator, GtOperator, GteOperator, AndOperator, OrOperator
} from '../ActivationConditions';
import { ErlangRandomPolicy } from '../ActivationSamplePolicy';

import skills from '../data/skill_data.json';
import skillnames from '../data/skillnames.json';

program
	.argument('<cmdef>', 'path to CM definition file')
	.addOption(new Option('-N, --nsamples <N>', 'number of random samples to use for skills with random conditions')
		.default(500)
		.argParser(x => parseInt(x,10))
	)
	.addOption(new Option('-s, --strategy <strategy>', 'strategy to test skills for')
		.choices(['nige', 'senkou', 'sasi', 'oikomi'])
		.makeOptionMandatory()
	)
	.addOption(new Option('-m, --mood <mood>', 'the uma\'s mood')
		.choices(['-2', '-1', '0', '+1', '+2'])
		.default(2, '+2')
		.argParser(x => parseInt(x,10))  // can't just use .argParser(parseInt) because it also gets passed the default value
	)
	.option('--no-position-keep', 'disable position keep simulation')
	.addOption(new Option('--timestep <dt>', 'integration timestep in seconds (can be an integer, decimal, or fraction)')
		.default(1/15, '1/15')
		.argParser(ts => ts.split('/').reduceRight((a,b) => +b / +a, 1.0)))  // reduceRight with initial acc = 1.0 to make the types work
	.addOption(new Option('-D, --distance-aptitude <letter>', 'distance aptitude')
		.choices(['S', 'A', 'B', 'C', 'D', 'E', 'F', 'G'])
		.default('S')
	)
	.addOption(new Option('-G, --surface-aptitude <letter>', 'surface aptitude')
		.choices(['S', 'A', 'B', 'C', 'D', 'E', 'F', 'G'])
		.default('A')
	)
	.addOption(new Option('-S, --strategy-aptitude <letter>', 'strategy aptitude')
		.choices(['S', 'A', 'B', 'C', 'D', 'E', 'F', 'G'])
		.default('A')
	)
	.addOption(new Option('--lang <language>', 'language for printing skill names').choices(['jp', 'en']).default('jp'));

program.parse();
const options = program.opts();

const cmdef = JSON.parse(fs.readFileSync(program.args[0], 'utf8'));

const WEATHER = Object.freeze({
	SUNNY: 1,
	CLOUDY: 2,
	RAINY: 3,
	SNOWY: 4
});

const SEASONS = Object.freeze({
	SPRING: 1,
	SUMMER: 2,
	AUTUMN: 3,
	WINTER: 4
});

const horsedesc = Object.assign({
	strategy: options.strategy,
	distanceAptitude: options.distanceAptitude,
	surfaceAptitude: options.surfaceAptitude,
	strategyAptitude: options.strategyAptitude
}, cmdef.baseStats);

const builder = new RaceSolverBuilder(options.nsamples)
	.horse(horsedesc)
	.course(cmdef.courseid)
	.mood(options.mood)
	.ground(cmdef.groundCondition)
	.withActivateCountsAsRandom()
	.withAsiwotameru();

if (options.positionKeep) {
	builder.useDefaultPacer();
}

cmdef.presupposedSkills[options.strategy].forEach(id => builder.addSkill(id));

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

function isCmpOperator(tree: Operator): tree is CmpOperator {
	return 'condition' in tree;
}

function assertIsCmpOperator(tree: Operator): asserts tree is CmpOperator {
	assert(isCmpOperator(tree));
}

function doFlatten(node: Operator, condGroups: CmpOperator[][]) {
	if (node instanceof OrOperator) {
		doFlatten(node.left, condGroups);
		condGroups.push([]);
		doFlatten(node.right, condGroups);
	} else if (node instanceof AndOperator) {
		doFlatten(node.left, condGroups);
		doFlatten(node.right, condGroups);
	} else {
		assertIsCmpOperator(node);
		condGroups[condGroups.length-1].push(node);
	}
}

function flattenConditions(tree: Operator) {
	const groups = [[]];
	doFlatten(tree, groups);
	return groups;
}

const thisWeather = WEATHER[cmdef.weather.toUpperCase()];
const thisSeason = SEASONS[cmdef.season.toUpperCase()];

function notMatchRaceConditions(groups: CmpOperator[][]) {
	if (groups.length == 0) return false;
	return groups.every(conds => conds.some(c => {
		return c instanceof EqOperator
		    && (   (c.condition == mockConditions['weather'] && c.argument != thisWeather)
		        || (c.condition == mockConditions['ground_condition'] && c.argument != builder._ground)
		        || (c.condition == mockConditions['season'] && c.argument != thisSeason));
	}));
}

function intersect(a: Set<number>, b: Set<number>) {
	const i = new Set();
	a.forEach(n => {
		if (b.has(n)) i.add(n);
	});
	return i;
}

function rangeForCondition(c: CmpOperator, scaledArgument: number) {
	const r = new Set();
	if (c instanceof EqOperator) {
		r.add(scaledArgument);
	} else if (c instanceof GtOperator) {
		for (let i = scaledArgument + 1; i <= cmdef.totalUmas; ++i) {
			r.add(i);
		}
	} else if (c instanceof LtOperator) {
		for (let i = 1; i < scaledArgument; ++i) {
			r.add(i);
		}
	} else if (c instanceof GteOperator) {
		for (let i = scaledArgument; i <= cmdef.totalUmas; ++i) {
			r.add(i);
		}
	} else if (c instanceof LteOperator) {
		for (let i = 1; i <= scaledArgument; ++i) {
			r.add(i);
		}
	} else {
		throw new Error('unexpected operator');
	}
	return r;
}

function extractOrderRange(conds: CmpOperator[]) {
	const all = new Set<number>();
	for (let i = 1; i <= cmdef.totalUmas; ++i) {
		all.add(i);
	}
	return conds.reduce((range,c) => {
		let r = null, m;
		if (c.condition == mockConditions['order']) {
			r = rangeForCondition(c, c.argument);
		} else if (c.condition == mockConditions['order_rate']) {
			r = rangeForCondition(c, Math.round(cmdef.totalUmas * (c.argument / 100.0)));
		} else if ((m = /order_rate_in(\d+)_continue/.exec((c.condition as any).name))) {
			r = new Set();
			const bound = Math.round(cmdef.totalUmas * (m[1] / 100.0));
			for (let i = 1; i <= bound; ++i) {
				r.add(i);
			}
		} else if ((m = /order_rate_out(\d+)_continue/.exec((c.condition as any).name))) {
			r = new Set();
			for (let i = Math.round(cmdef.totalUmas * (m[1] / 100.0)); i <= cmdef.totalUmas; ++i) {
				r.add(i);
			}
		}
		return r != null ? intersect(r, range) : range;
	}, all);
}

function strategyMatches(groups: CmpOperator[][]) {
	if (groups.length == 0) return true;
	return groups.some(conds => {
		const range = extractOrderRange(conds);
		return cmdef.strategyPositions[options.strategy].some(i => range.has(i));
	});
}

const greens = [], pinks = [], golds = [], whites = [], uniques = [];

const BLACKLIST_ALL = ['910071', '200333', '200343', '202303', '201081'];

Object.keys(skills).forEach(id => {
	if (BLACKLIST_ALL.indexOf(id) > -1) return;

	const skill = skills[id];
	let skip = skill.alternatives.every(alt => {
		const pregroups = alt.precondition.length > 0 ? flattenConditions(parse(tokenize(alt.precondition), {conditions: mockConditions})) : [];
		const groups = flattenConditions(parse(tokenize(alt.condition), {conditions: mockConditions}));

		return (notMatchRaceConditions(pregroups) || notMatchRaceConditions(groups)) || !(strategyMatches(pregroups) && strategyMatches(groups));
	});

	if (skip) return;

	// assume there are no skills with mixed green/non-green effects (this is true and would be very weird if it was violated)
	if (skill.alternatives[0].effects.some(ef => ef.type <= SkillType.WisdomUp)) {
		greens.push(id);
	} else if (skill.rarity == SkillRarity.Evolution) {
		pinks.push(id);
	} else if (skill.rarity == SkillRarity.Gold) {
		golds.push(id);
	} else if (id[0] == '9') {
		uniques.push(id);
	} else if (skill.rarity == SkillRarity.White) {
		whites.push(id);
	}
});

function calcRows(skillids, thresholds: number[]) {
	const dt = options.timestep;
	const horse = buildBaseStats(builder._horse, builder._mood);
	const rows = skillids.map(id => {
		const b1 = builder.fork();
		const b2 = b1.fork();
		b2.addSkill(id);

		const wholeCourse = new RegionList();
		wholeCourse.push(new Region(0, b2._course.distance));
		let sd;
		try {
			sd = buildSkillData(horse, b2._course, wholeCourse, b2._conditions, id);
		} catch (e) {
			return null;
		}
		if (sd == null) return null;
		const modeled = sd.samplePolicy instanceof ErlangRandomPolicy;

		const g1 = b1.build();
		const g2 = b2.build();
		const gain = [];
		for (let i = 0; i < options.nsamples; ++i) {
			const s1 = g1.next().value as RaceSolver;
			const s2 = g2.next().value as RaceSolver;

			while (s2.pos < b2._course.distance) {
				s2.step(dt);
			}
			while (s1.accumulatetime.t < s2.accumulatetime.t) {
				s1.step(dt);
			}
			gain.push((s2.pos - s1.pos) / 2.5);
		}

		gain.sort((a,b) => a - b);
		const mid = Math.floor(gain.length / 2);
		const median = gain.length % 2 == 0 ? (gain[mid-1] + gain[mid]) / 2 : gain[mid];
		const mean = gain.reduce((a,b) => a + b) / gain.length;

		return {
			name: (modeled ? '*' : '') + skillnames[id][+(options.lang == 'en')],
			min: gain[0],
			max: gain[gain.length-1],
			median,
			mean,
			thresholds: thresholds.map(n => gain.reduce((a,b) => a + +(b >= n), 0) / gain.length)
		};
	}).filter(r => r != null && r.max > 0.0);
	rows.sort((a,b) => b.median - a.median);
	return rows;
}

function printGreens(rows) {
	console.log('バ身,スキル,,,,,,');
	rows.forEach(r => {
		console.log(r.median.toFixed(2) + ',' + r.name + ',,,,,,');
	});
	console.log('');
}

function printRows(rows, thresholdColNames) {
	console.log('中央,スキル,最小,最大,平均,' + thresholdColNames);
	rows.forEach(r => {
		const cols = [r.median.toFixed(2), r.name, Math.max(r.min, 0.0).toFixed(2), r.max.toFixed(2), r.mean.toFixed(2)];
		cols.push.apply(cols, r.thresholds.map(t => t.toFixed(2)));
		console.log(cols.join(','));
	});
	console.log('');
}

printGreens(calcRows(greens, []));
printRows(calcRows(pinks, [1.0,2.0,3.0]), '≥1.00,≥2.00,≥3.00');
printRows(calcRows(golds, [1.0,2.0,3.0]), '≥1.00,≥2.00,≥3.00');
printRows(calcRows(whites, [0.5,1.0,1.5]), '≥0.50,≥1.00,≥1.50');
printRows(calcRows(uniques, [0.5,1.0,1.5]), '≥0.50,≥1.00,≥1.50');
