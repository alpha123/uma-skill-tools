import { program, Option } from 'commander';

import { getParser } from '../ConditionParser';
import { mockConditions, treeMatch } from './ConditionMatcher';

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

const { parseAny, parse, tokenize } = getParser(mockConditions);

const match = opts.name ? opts.condition.toUpperCase() : parseAny(tokenize(opts.condition));

for (const id in skills) {
	if (id[0] == '9') continue;
	let logged = false;
	skills[id].alternatives.forEach(ef => {
		if (
		   opts.name ? skillnames[id].find(s => s.toUpperCase().indexOf(match) > -1)
		 : (!opts.excludePre && ef.precondition.length > 0 && treeMatch(match, parse(tokenize(ef.precondition))))
		|| (!opts.pre && ef.condition.length > 0 && treeMatch(match, parse(tokenize(ef.condition))))
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
