import * as fs from 'fs';
import * as path from 'path';
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

(test as any).Test.prototype.almostEqual = function (a: number, b: number, msg: string, extra: any) {
	this._assert(almostEqual(a, b), {
		message: msg || 'should be closer than ' + Math.max(Epsilon * (Math.abs(a) + Math.abs(b)), Number.EPSILON) + ' (actual difference: ' + Math.abs(a - b) + ')',
		operator: 'almostEqual',
		actual: a,
		expected: b,
		extra: extra
	});
}

function getLatestCheckpoint() {
	const dir = path.join(path.dirname(process.argv[1]), 'checkpoints');
	// sort by the date contained in the filename; we can't sort by ctime/mtime since git does not preserve those when cloning
	// this does mean this isn't guaranteed to find the latest file if multiple checkpoints were created on the same day, but we can
	// simply avoid doing that for the most part.
	// we could of course simply include the exact timestamp in the filename, but i dont like how that looks.
	return fs.readdirSync(dir)
		.map(f => [path.join(dir, f), Date.parse(f.split('.',1)[0].replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'))] as [string,number])
		.sort((a,b) => b[1] - a[1])[0][0];
}

program
	.argument('[cases]', 'JSON file of test cases')
	.option('--fast', 'tests a random sample of cases instead of the entire set')
	.addOption(new Option('--seed <number>', 'seed to use for random shuffle with --fast')
		.implies({fast: true})
		.default(Math.floor(Math.random() * (-1 >>> 0)) >>> 0)
		.argParser(n => parseInt(n,10) >>> 0))
	.option('-l, --failure-log <file>', 'file to log failing cases to', 'failures.json');

program.parse();
const options = program.opts();

const casefile = program.args.length > 0 ? program.args[0] : getLatestCheckpoint();
let cases = JSON.parse(fs.readFileSync(casefile, 'utf-8'));

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
					(t as any).almostEqual(s1.pos - s2.pos, testCase.result.gain[i]);
					failures.push({params: testCase.params, caseIdx: (t as any).assertCount - 1, sampleIdx: i, expected: testCase.result.gain[i], actual: s1.pos - s2.pos});
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
