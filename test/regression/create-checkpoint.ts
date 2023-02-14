import * as fs from 'fs';
import * as path from 'path';
import * as fc from 'fast-check';
import { program, Option } from 'commander';

import * as arb from '../arb/Race';
import { RaceSolver } from '../../RaceSolver';

program
	.addOption(new Option('-t, --tests <number>', 'number of test cases to generate')
		.default(10000)
		.argParser(n => parseInt(n,10)))
	.addOption(new Option('--timestep <dt>', 'integration timestep in seconds')
		.default(1/15, '1/15')
		.argParser(ts => ts.split('/').reduceRight((a,b) => +b / +a, 1.0)))
	.addOption(new Option('--seed <number>', 'seed for random generator')
		.default((Date.now() ^ (Math.random() * 0x100000000)) >>> 0)  // this seems to be what fast-check uses by default
		.argParser(x => parseInt(x,10)));

program.parse();
const options = program.opts();

fc.configureGlobal({seed: options.seed});

const results = [];
fc.sample(arb.Race(), options.tests).forEach(params => {
	const standard = arb.makeBuilder(params);
	const compare = standard.fork();
	params.skillsUnderTest.forEach(id => compare.addSkill(id));
	const g1 = compare.build();
	const g2 = standard.build();
	const result = {err: false, gain: []};
	for (let i = 0; i < params.nsamples; ++i) {
		try {
			const s1 = g1.next().value as RaceSolver;
			const s2 = g2.next().value as RaceSolver;

			while (s1.pos < standard._course.distance) {
				s1.step(options.timestep);
			}

			while (s2.accumulatetime.t < s1.accumulatetime.t) {
				s2.step(options.timestep);
			}

			result.gain.push(s1.pos - s2.pos);
		} catch (_) {
			result.err = true;
			break;
		}
	}
	results.push({params, result, timestep: options.timestep});
});

let root = path.resolve(path.dirname(process.argv[1]), '..', '..');
const head = fs.readFileSync(path.join(root, '.git', 'HEAD'), 'utf-8').trim();
const rev = head.startsWith('ref: ') ? fs.readFileSync(path.join(root, '.git', head.slice(5)), 'utf-8').trim() : head;
const date = new Date().toISOString().slice(0,10).replace(/-/g,'');  // why does this godforsaken programming language not have normal date formatting
const outfile = path.join(path.dirname(process.argv[1]), 'checkpoints', date + '.' + rev.slice(0,7) + '.' + options.seed + '.json');

fs.writeFileSync(outfile, JSON.stringify(results));

console.log('wrote ' + outfile);
