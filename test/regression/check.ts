import * as fs from 'fs';
import test from 'tape';
import { program, Option } from 'commander';

import { makeBuilder } from '../arb/Race';
import { RaceSolver } from '../../RaceSolver';
import { Rule30CARng } from '../../Random';

// This is more or less arbitrary but results in basically the level of precision we care about for the sim results.
const Epsilon = 5e11 * Number.EPSILON;
function almostEqual(a: number, b: number) {
	if (a == b) return true;
	return Math.abs(a - b) < Math.max(Epsilon * (Math.abs(a) + Math.abs(b)), Number.EPSILON);
}

program
	.argument('<cases>', 'JSON file of test cases')
	.option('--fast', 'tests a random sample of cases instead of the entire set')
	.addOption(new Option('--seed <number>', 'seed to use for random shuffle with --fast')
		.implies({fast: true})
		.default(Math.floor(Math.random() * (-1 >>> 0)) >>> 0)
		.argParser(n => parseInt(n,10) >>> 0))
	.option('-l, --failure-log <file>', 'file to log failing cases to', 'failures.json');

program.parse();
const options = program.opts();

let cases = JSON.parse(fs.readFileSync(program.args[0], 'utf-8'));

if (options.fast) {
	const rng = new Rule30CARng(options.seed);
	for (let i = cases.length; --i >= 0;) {
		const j = rng.uniform(i + 1);
		[cases[i], cases[j]] = [cases[j], cases[i]];
	}
	cases = cases.slice(0,100);
}

test('should give results similar to the checkpoint', t => {
	t.plan(cases.length + cases.reduce((a,b) => a + b.params.nsamples * +!b.result.err, 0));

	const failures = [];
	cases.forEach(testCase => {
		const standard = makeBuilder(testCase.params);
		const compare = standard.fork();
		testCase.params.skillsUnderTest.forEach(id => compare.addSkill(id));
		const g1 = compare.build();
		const g2 = standard.build();
		let err = false;
		for (let i = 0; i < testCase.params.nsamples; ++i) {
			try {
				const s1 = g1.next().value as RaceSolver;
				const s2 = g2.next().value as RaceSolver;

				while (s1.pos < standard._course.distance) {
					s1.step(testCase.timestep);
				}

				while (s2.accumulatetime.t < s1.accumulatetime.t) {
					s2.step(testCase.timestep);
				}

				if (almostEqual(s1.pos - s2.pos, testCase.result.gain[i])) {
					t.ok(true);
				} else {
					t.ok(false);
					failures.push({params: testCase.params, sampleIdx: i, expected: testCase.result.gain[i], actual: s1.pos - s2.pos});
				}
			} catch (_) {
				err = true;
				break;
			}
		}
		t.assert(err == testCase.result.err);
	});

	if (failures.length > 0) {
		fs.writeFileSync(options.failureLog, JSON.stringify(failures));
		t.comment('wrote ' + failures.length + ' failure' + (failures.length == 1 ? '' : 's') + ' to ' + options.failureLog);
	}

	if (options.fast) {
		t.comment('seed ' + options.seed);
	}
});
