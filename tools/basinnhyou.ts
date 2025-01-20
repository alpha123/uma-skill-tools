const assert = require('assert').strict;

import * as fs from 'fs';
import { format } from 'util';
import { program, Option } from 'commander';

import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

import { RaceSolver, SkillType, SkillRarity } from '../RaceSolver';
import { RaceSolverBuilder, buildBaseStats, buildSkillData } from '../RaceSolverBuilder';
import { Region, RegionList } from '../Region';
import { getParser } from '../ConditionParser';
import {
	Operator, CmpOperator, EqOperator, NeqOperator, LtOperator, LteOperator, GtOperator, GteOperator, AndOperator, OrOperator
} from '../ActivationConditions';
import { ErlangRandomPolicy } from '../ActivationSamplePolicy';
import { mockConditions } from './ConditionMatcher';

import skills from '../data/skill_data.json';
import skillnames from '../data/skillnames.json';

program
	.argument('<cmdef>', 'path to CM definition file')
	.option('--csv', 'output chart as a CSV file', true)
	.addOption(new Option('--sheet <sheet ID>', 'use the Google Sheets API').implies({'csv': false}))
	.addOption(new Option('--api-key <path to key>', 'path to service account private key (JSON)').env('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY'))
	.addOption(new Option('-N, --nsamples <N>', 'number of random samples to use for skills with random conditions')
		.default(500)
		.argParser(x => parseInt(x,10))
	)
	.addOption(new Option('-s, --strategy <strategy>', 'strategy to test skills for')
		.choices(['nige', 'senkou', 'sasi', 'oikomi'])
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

const lang = +(options.lang == 'en');

const cmdef = JSON.parse(fs.readFileSync(program.args[0], 'utf8'));

function getBuilder(strategy: string) {
	const horsedesc = Object.assign({
		strategy: strategy,
		distanceAptitude: options.distanceAptitude,
		surfaceAptitude: options.surfaceAptitude,
		strategyAptitude: options.strategyAptitude
	}, cmdef.baseStats);

	const builder = new RaceSolverBuilder(options.nsamples)
		.horse(horsedesc)
		.course(cmdef.courseid)
		.mood(options.mood)
		.ground(cmdef.groundCondition)
		.weather(cmdef.weather)
		.season(cmdef.season)
		.time(cmdef.time || 'Midday')
		.popularity(!('popularity' in cmdef) ? 1 : cmdef.popularity < 0 ? cmdef.totalUmas + 1 + cmdef.popularity : cmdef.popularity)
		.withActivateCountsAsRandom()
		.withAsiwotameru();

	if (options.positionKeep) {
		builder.useDefaultPacer();
	}

	cmdef.presupposedSkills[strategy].forEach(id => builder.addSkill(id.toString()));
	return builder;
}

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

const BLACKLIST_ALL = ['910071', '200333', '200343', '202303', '201081', '201561', '105601211'];
const ALWAYS_WHITELIST = ['910151', '900771'];

const { parse, tokenize } = getParser(mockConditions);

Object.keys(skills).forEach(id => {
	if (BLACKLIST_ALL.indexOf(id) > -1) return;
	if (cmdef.presupposedSkills[options.strategy].indexOf(id) > -1) return;

	const skill = skills[id];
	let skip = skill.alternatives.every(alt => {
		const pregroups = alt.precondition.length > 0 ? flattenConditions(parse(tokenize(alt.precondition))) : [];
		const groups = flattenConditions(parse(tokenize(alt.condition)));

		return !(strategyMatches(pregroups) && strategyMatches(groups));
	});

	if (skip && ALWAYS_WHITELIST.indexOf(id) == -1) return;

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

const normalParser = getParser();

function calcRows(builder, skillids, thresholds: number[]) {
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
			sd = buildSkillData(horse, b2._raceParams, b2._course, wholeCourse, normalParser, id);
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
			id,
			name: (modeled ? '*' : '') + skillnames[id][0] + (lang == 1 ? '\n' + skillnames[id][1] : ''),
			min: gain[0],
			max: gain[gain.length-1],
			median,
			mean,
			thresholds: thresholds.map(n => gain.reduce((a,b) => a + +(n > 0 ? b >= n : b < -n), 0) / gain.length)
		};
	}).filter(r => r != null && r.max > 0.0);
	rows.sort((a,b) => b.mean - a.mean);
	return rows;
}

function printGreens(rows) {
	console.log('バ身,スキル,,,,,,');
	rows.forEach(r => {
		console.log(r.median.toFixed(2) + ',' + r.name + ',,,,,,');
	});
	console.log('');
}

function displayRow(r) {
	const cols = [r.mean.toFixed(2), r.name, Math.max(r.min, 0.0).toFixed(2), r.max.toFixed(2), r.median.toFixed(2)];
	cols.push.apply(cols, r.thresholds.map(t => t.toFixed(2)));
	return cols;
}

function printRows(rows, thresholdColNames) {
	console.log('平均,スキル,最小,最大,中央,' + thresholdColNames);
	rows.forEach(r => {
		const cols = displayRow(r);
		console.log(cols.join(','));
	});
	console.log('');
}

const SHEET_NAMES = Object.freeze({
	'nige': ['逃げ', 'Runner'],
	'senkou': ['先行', 'Leader'],
	'sasi': ['差し', 'Betweener'],
	'oikomi': ['追込', 'Chaser']
});

const COL_NAME_SETS = Object.freeze({
	greens: [['バ身','スキル'], ['Bashin gain','Skill name']],
	pinks_golds: [['平均','スキル','最小','最大','中央','<0.25','≥0.75','≥1.50'], ['Mean','Skill name','Min','Max','Median','<0.25','≥0.75','≥1.50']],
	whites_uniques: [['平均','スキル','最小','最大','中央','<0.15','≥0.33','≥0.67'], ['Mean','Skill name','Min','Max','Median','<0.15','≥0.33','≥0.67']]
});

const STRINGS = Object.freeze({
	'zennteizyoukenn': ['前提条件', 'Assumed'],
	'speed': ['スピード', 'Speed'],
	'stamina': ['スタミナ', 'Stamina'],
	'power': ['パワー', 'Power'],
	'guts': ['根性', 'Guts'],
	'wisdom': ['賢さ', 'Wisdom'],
	'status': ['ステータス', 'Stats'],
	'aptitude': ['適性', 'Aptitudes'],
	'skill': ['スキル', 'Skills'],
	'dist': ['距離%s', 'Distance: %s'],
	'surface': ['バ場%s', 'Surface: %s'],
	'strat': ['脚質%s', 'Strategy: %s'],
	',': ['、', ', '],
	'disclaimer': [
		'＊マークの付いているスキルの発動位置は他のウマ娘のポジションに影響される為、確率分布による推計を取り入れています。平均値・中央値についてはあくまで参考程度に留めておいて下さい。',
		'* When the marked skills activate is dependent on other umas, so their proc location is estimated instead. Take the mean/median numbers with a grain of salt.'
	]
});

function rgb(r,g,b) {
	return {'red': r / 255, 'green': g / 255, 'blue': b / 255};
}

function colorForSkill(id: string) {
	const skill = skills[id];
	if (skill.rarity == SkillRarity.Evolution) {
		return rgb(255,230,250);
	} else if (skill.rarity == SkillRarity.Gold) {
		return rgb(255,239,213);
	} else if (id[0] == '9') {
		return rgb(255,255,255);
	} else if (skill.alternatives[0].effects.some(ef => ef.type <= SkillType.WisdomUp)) {
		return rgb(230,255,233);
	} else {
		return rgb(255,255,238);
	}
}

const THRESHOLDS_PINK_GOLD = [-0.25,0.75,1.50];
const THRESHOLDS_WHITE_UNIQUE = [-0.15,0.33,0.67];

if (options.csv) {
	const builder = getBuilder(options.strategy);
	printGreens(calcRows(builder, greens, []));
	printRows(calcRows(builder, pinks, THRESHOLDS_PINK_GOLD), '<0.25,≥0.75,≥1.50');
	printRows(calcRows(builder, golds, THRESHOLDS_PINK_GOLD), '<0.25,≥0.75,≥1.50');
	printRows(calcRows(builder, whites, THRESHOLDS_WHITE_UNIQUE), '<0.15,≥0.33,≥0.67');
	printRows(calcRows(builder, uniques, THRESHOLDS_WHITE_UNIQUE), '<0.15,≥0.33,≥0.67');
} else {
	const apiKey = JSON.parse(fs.readFileSync(options.apiKey, 'utf8'));
	const auth = new JWT({
		email: apiKey['client_email'],
		key: apiKey['private_key'],
		scopes: ['https://www.googleapis.com/auth/spreadsheets']
	});

	const doc = new GoogleSpreadsheet(options.sheet, auth);

	const strategies = options.strategy ? [options.strategy] : ['nige', 'senkou', 'sasi', 'oikomi'];
	strategies.forEach(async strategy => {
		const builder = getBuilder(strategy);
		const greenRows = calcRows(builder, greens, [])
		    , pinkRows = calcRows(builder, pinks, THRESHOLDS_PINK_GOLD)
		    , goldRows = calcRows(builder, golds, THRESHOLDS_PINK_GOLD)
		    , whiteRows = calcRows(builder, whites, THRESHOLDS_WHITE_UNIQUE)
		    , uniqueRows = calcRows(builder, uniques, THRESHOLDS_WHITE_UNIQUE);

		const sheet = await doc.addSheet({'title': SHEET_NAMES[strategy][lang]});
		await sheet.setHeaderRow(COL_NAME_SETS.greens[lang], 1);
		await sheet.addRows(greenRows.map(r => [r.median.toFixed(2), r.name]));

		await sheet.setHeaderRow(COL_NAME_SETS.pinks_golds[lang], greenRows.length + 3);
		await sheet.addRows(pinkRows.map(displayRow));

		await sheet.setHeaderRow(COL_NAME_SETS.pinks_golds[lang], greenRows.length + pinkRows.length + 5);
		await sheet.addRows(goldRows.map(displayRow));

		await sheet.setHeaderRow(COL_NAME_SETS.whites_uniques[lang], greenRows.length + pinkRows.length + goldRows.length + 7);
		await sheet.addRows(whiteRows.map(displayRow));

		await sheet.setHeaderRow(COL_NAME_SETS.whites_uniques[lang], greenRows.length + pinkRows.length + goldRows.length + whiteRows.length + 9);
		await sheet.addRows(uniqueRows.map(displayRow));

		await sheet.updateDimensionProperties('COLUMNS', {'pixelSize': 244} as any, {'startIndex': 1, 'endIndex': 2});

		await sheet.loadCells({
			startRowIndex: 0,
			startColumnIndex: 0,
			endRowIndex: greenRows.length + pinkRows.length + goldRows.length + whiteRows.length + uniqueRows.length + 10,
			endColumnIndex: COL_NAME_SETS.pinks_golds[0].length
		});

		const sections = [greenRows, pinkRows, goldRows, whiteRows, uniqueRows];
		const sectionOffsets = [
			0,
			greenRows.length + 2,
			greenRows.length + pinkRows.length + 4,
			greenRows.length + pinkRows.length + goldRows.length + 6,
			greenRows.length + pinkRows.length + goldRows.length + whiteRows.length + 8
		];

		sectionOffsets.forEach((r,i) => {
			const ncols = i == 0 ? COL_NAME_SETS.greens[0].length : COL_NAME_SETS.pinks_golds[0].length;
			for (let c = 0; c < ncols; ++c) {
				sheet.getCell(r,c).textFormat = {'bold': true};
			}
		});

		sectionOffsets.push(greenRows.length + pinkRows.length + goldRows.length + whiteRows.length + uniqueRows.length + 10);
		const valueRanges = [], ltPercentRanges = [], gtePercentRanges = [];
		for (let i = 0; i < sectionOffsets.length - 1; ++i) {
			const rfirst = sectionOffsets[i] + 1, rlast = sectionOffsets[i + 1] - 2;
			valueRanges.push({'sheetId': sheet.sheetId, 'startRowIndex': rfirst, 'endRowIndex': rlast + 1, 'startColumnIndex': 0, 'endColumnIndex': 1});
			const cols = i == 0 ? [0] : [0, 2, 3, 4];
			const percentCols = i == 0 ? [] : [5, 6, 7];
			if (i > 0) {
				valueRanges.push({'sheetId': sheet.sheetId, 'startRowIndex': rfirst, 'endRowIndex': rlast + 1, 'startColumnIndex': 2, 'endColumnIndex': 5});
				ltPercentRanges.push({'sheetId': sheet.sheetId, 'startRowIndex': rfirst, 'endRowIndex': rlast + 1, 'startColumnIndex': 5, 'endColumnIndex': 6})
				gtePercentRanges.push({'sheetId': sheet.sheetId, 'startRowIndex': rfirst, 'endRowIndex': rlast + 1, 'startColumnIndex': 6, 'endColumnIndex': 8});
			}
			for (let r = rfirst; r <= rlast; ++r) {
				sheet.getCell(r,1).backgroundColor = colorForSkill(sections[i][r - rfirst].id);
				cols.forEach(c => sheet.getCell(r,c).numberFormat = {'type': 'NUMBER', 'pattern': '0.00'});
				percentCols.forEach(c => sheet.getCell(r,c).numberFormat = {'type': 'PERCENT', 'pattern': '0.00%'}); 
				if (lang == 1) {
					//sheet.getCell(r,1).note = skillnames[sections[i][r - rfirst].id][1];
					cols.forEach(c => sheet.getCell(r,c).verticalAlignment = 'MIDDLE');
					percentCols.forEach(c => sheet.getCell(r,c).verticalAlignment = 'MIDDLE');
				}
			}
			if (lang == 1) {
				await sheet.updateDimensionProperties('ROWS', {'pixelSize': 40} as any, {'startIndex': rfirst, 'endIndex': rlast + 1});
			}
		}
		await doc.sheetsApi.post(':batchUpdate', {
			'requests': [{
				'addConditionalFormatRule': {
					'rule': {
						'ranges': valueRanges,
						'gradientRule': {
							'minpoint': {
								'color': rgb(255,255,255),
								'type': 'NUMBER',
								'value': '0.0'
							},
							'maxpoint': {
								'color': rgb(255,214,102),
								'type': 'NUMBER',
								'value': '2.0'
							}
						}
					},
					'index': 0
				}
			}, {
				'addConditionalFormatRule': {
					'rule': {
						'ranges': gtePercentRanges,
						'gradientRule': {
							'minpoint': {
								'color': rgb(255,255,255),
								'type': 'NUMBER',
								'value': '0.0'
							},
							'maxpoint': {
								'color': rgb(87,187,138),
								'type': 'NUMBER',
								'value': '1.0'
							}
						}
					},
					'index': 0
				}
			}, {
				'addConditionalFormatRule': {
					'rule': {
						'ranges': ltPercentRanges,
						'gradientRule': {
							'minpoint': {
								'color': rgb(255,255,255),
								'type': 'NUMBER',
								'value': '0.0'
							},
							'maxpoint': {
								'color': rgb(230,124,115),
								'type': 'NUMBER',
								'value': '1.0'
							}
						}
					},
					'index': 0
				}
			}]
		});

		await sheet.loadCells('D1:I7');
		sheet.getCellByA1('D1').value = STRINGS['zennteizyoukenn'][lang];
		sheet.getCellByA1('E1').value = STRINGS['speed'][lang];
		sheet.getCellByA1('F1').value = STRINGS['stamina'][lang];
		sheet.getCellByA1('G1').value = STRINGS['power'][lang];
		sheet.getCellByA1('H1').value = STRINGS['guts'][lang];
		sheet.getCellByA1('I1').value = STRINGS['wisdom'][lang];
		sheet.getCellByA1('D2').value = STRINGS['status'][lang];
		sheet.getCellByA1('D3').value = STRINGS['aptitude'][lang];
		sheet.getCellByA1('D4').value = STRINGS['skill'][lang];
		sheet.getCellByA1('D2').horizontalAlignment = 'RIGHT';
		sheet.getCellByA1('D3').horizontalAlignment = 'RIGHT';
		sheet.getCellByA1('D4').horizontalAlignment = 'RIGHT';

		sheet.getCellByA1('E2').value = cmdef.baseStats.speed;
		sheet.getCellByA1('F2').value = cmdef.baseStats.stamina;
		sheet.getCellByA1('G2').value = cmdef.baseStats.power;
		sheet.getCellByA1('H2').value = cmdef.baseStats.guts;
		sheet.getCellByA1('I2').value = cmdef.baseStats.wisdom;

		sheet.getCellByA1('E3').value = [
			format(STRINGS['dist'][lang], options.distanceAptitude),
			format(STRINGS['surface'][lang], options.surfaceAptitude),
			format(STRINGS['strat'][lang], options.strategyAptitude)
		].join(STRINGS[','][lang]);

		sheet.getCellByA1('E4').value = cmdef.presupposedSkills[strategy].map(id => skillnames[id][0]).join(STRINGS[','][0]);
		if (lang != 0) {  // non-jp
			sheet.getCellByA1('E4').note = cmdef.presupposedSkills[strategy].map(id => skillnames[id][lang]).join(STRINGS[','][lang]);
			sheet.getCellByA1('E4').textFormat = {'bold': true};
		}

		sheet.getCellByA1('D6').value = STRINGS['disclaimer'][lang];
		if (lang != 1) {
			sheet.getCellByA1('D6').wrapStrategy = 'WRAP';
			await sheet.mergeCells({'startRowIndex': 5, 'endRowIndex': 7, 'startColumnIndex': 3, 'endColumnIndex': 9});
		}

		await sheet.saveUpdatedCells();
	});
}
