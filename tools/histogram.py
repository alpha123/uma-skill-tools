import sys
import argparse
import json
import matplotlib.pyplot as plt
from matplotlib import font_manager

opts = argparse.ArgumentParser()
opts.add_argument('--bin-width', '-w', type=float, default=0.05)
opts.add_argument('--cumulative', '-C', action='store_true')
opts.add_argument('--density', '-D', action='store_true')
args = opts.parse_args()

if args.cumulative and args.density:
	ylabel = 'Cumulative probability density'
elif args.cumulative:
	ylabel = 'Cumulative frequency'
elif args.density:
	ylabel = 'Probability density'
else:
	ylabel = 'Frequency'

font = font_manager.FontProperties()
font.set_family('MS Gothic')

data = json.load(sys.stdin)

plt.hist(x=data, bins=round((data[-1] - data[0]) / args.bin_width), cumulative=-1 * args.cumulative, density=args.density)
plt.xlabel('Distance gain (バ身)', font=font)
plt.ylabel(ylabel, font=font)
plt.tight_layout()
plt.show()
