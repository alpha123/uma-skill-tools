import sys
import math
import argparse
import json
import matplotlib
import matplotlib.pyplot as plt

args = argparse.ArgumentParser()
args.add_argument('--title', help='title for the plot')
args.add_argument('--save', help='save plot to file instead of showing an interactive display')
opts = args.parse_args()

matplotlib.rcParams['font.family'] = 'MS Gothic'

data = json.load(sys.stdin)
gain = data['gain']
mingain = min(map(min, gain))
maxgain = max(map(max, gain))
vmin = -max(abs(mingain), abs(maxgain))
vmax = max(abs(mingain), abs(maxgain))

ticks = [round(mingain,1)]
t = 1.5 * math.ceil(mingain / 1.5)
while t < 1.5 * math.ceil(maxgain / 1.5):
	ticks.append(t)
	t += 1.5
ticks.append(round(maxgain,1))

x = list(range(data['speed']['start'], data['speed']['end'] + data['speed']['step'] + 1, data['speed']['step']))
y = list(range(data['guts']['start'], data['guts']['end'] + data['guts']['step'] + 1, data['guts']['step']))

fig,ax = plt.subplots()

c = ax.pcolormesh(x, y, gain, shading='flat', cmap='RdYlGn', vmin=vmin, vmax=vmax)
ax.axis([data['speed']['start'], data['speed']['end'] + data['speed']['step'], data['guts']['start'], data['guts']['end'] + data['guts']['step']])
plt.xlabel('Speed')
plt.ylabel('Guts')
fig.colorbar(c, ax=ax, boundaries=range(math.floor(mingain), math.ceil(maxgain) + 1), ticks=ticks) \
   .set_label(label=f"Distance gain relative to {data['standard']['speed']}/{data['standard']['guts']} (バ身)")

if opts.title:
	plt.title(opts.title)

if opts.save:
	plt.savefig(opts.save)
else:
	plt.show()
