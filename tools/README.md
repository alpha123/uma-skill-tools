# skillgrep.ts

Search skills by name or condition. For conditions it may be either just a condition name (e.g. phase_random) or a full condition specification with & and/or @. Order doesn't matter, so phase_random==1&running_style==3 matches running_style==3&phase_random==1. Partial condition names don't work.

Has a number of options controlling the output and what is searched. Run `ts-node skillgrep.ts --help` for a list.

Notably it searches conditions by default and you have to use the `-N` or `--name` option to search skill names. Unlike conditions names can be a partial match and can be given in English or Japanese. Romanized Japanese does not match.

# gain.ts

Reads an uma definition file and takes skills on the command line and simulates a race with and without the specified skills to report statistics about their effects in terms of バ身 gain. See nige.json, senkou.json, etc to get an idea of the definition format.

Has a fairly large number of options, but the most important are:

- `-c, --course <course id>` Required. Finding the ID for a given racecourse is kind of annoying, I just look in the course_data.json file. Sorry about that.
- `-m, --mood -2|-1|0|+1|+2` The uma's mood, where -2 to +2 correspond with 絶不調 to 絶好調. Defaults to +2.
- `-g, --ground good|yielding|soft|heavy` Ground condition. The choices correspond to 良, 稍重, 重, 不良.
- `-s, --skill <skill id>` or `--skills <comma-separated list of skill ids>` The skills to test. You can specify `-s` multiple times; this is equivalent to passing a comma-separated list of skills to `--skills`. Note that this tests the combination of skills, not each one separately. Run gain.ts multiple times for that. You can use skillgrep.ts with the `-d` option to find the ID for a skill, or GameTora shows them if you enable the ‘Show skill IDs’ setting.
- `--nsamples <integer>` Number of times to simulate races. Min/max/median/mean バ身 gain is reported from the results. Defaults to 500. You may want to increase it if you're comparing multiple random skills at once, to try to cover more pairs of random activation points. The simulator is relatively fast.
- `--dump` Intended to be piped into histogram.py to show a histogram of バ身 gain instead of just reporting a summary.

Run `ts-node gain.ts --help` for a full list.

Any skills you want both simulations to have should be specified in the uma definition file. There is a default file for each strategy:

- nige.json has inherited アングリング×スキーミング
- senkou.json has inherited つぼみ、ほころぶ時
- sasi.json has inherited レッツ・アナボリック！
- oikomi.json has 直線一気

To make updates easier it's probably best to copy the files if you want to modify them.

# dump.ts

Simulates a race and collects position/velocity/acceleration data at every timestep. Intended to be piped into plot.py.

Shares most of its options with gain.ts, including the same format for specifying umas. Unlike gain.ts, there is no difference between skills specified in the definition file and skills passed on the command line.

gain.ts output includes the lines `min configuration: ` and `max configuration: ` followed by a base64-encoded string. The `-C, --configuration` option of dump.ts can be used to load these to visualize the minimum and maximum samples from gain.ts. When doing this make sure to pass the exact same course, uma definition, and set of skills to gain.ts and dump.ts or the output will be meaningless.

# compare.ts

Takes two uma definition files and runs simulations with each of them to compare the results.

This is intended for comparisons that can't be made with gain.ts, for example comparing ums with different stats or comparing completely different sets of skills. Run `ts-node compare.ts --help` for options, but they're mostly the same as gain.ts.

# plot.py

Takes the output of dump.ts and plots it alongside the course features. Requires matplotlib to be installed.

Has a lot of options. Run `python plot.py --help` to see them. In most cases you probably want something like `-v -o 15 -hcspk`.

# histogram.py

Pipe a JSON array into it to see a histogram. Intended for use with the `--dump` option of gain.ts. Run `python histogram.py --help` for options. You probably want `-C` in most cases. Also requires matplotlib.

# speedguts.ts / speedguts_colormesh.py

Used for calculating the difference between various combinations of speed and guts stats. Besides the usual course/mood/ground options, it takes:

- `--speed-range <lower,upper>` and `--guts-range`: the ranges of speed and guts to test as a pair of integers `lower,upper` (inclusive of both)
- `--step <integer>` increments within the ranges to test
- `--standard <speed,guts>` pair of speed and guts to compare the other combinations with to report バ身 gain

The output of speedguts.ts is intended to be piped into speedguts_colormesh.py for visualization.

# make_skill_data.pl and make_skillnames.pl

Used to generate the data/skill_data.json and data/skillnames.json files. make_skill_data.pl takes a path to master.mdb and make_skillnames.pl takes a file obtained from a GameTora quasi-API thing.
