use strict;
use warnings;
use v5.012;
use utf8;

use FindBin;
use Getopt::Long;
use Pod::Usage;
use Scalar::Util qw(looks_like_number);
use List::Util qw(any all min max reduce);
use JSON::PP;

my $seed = int(rand(2 ** 31));
my $lang = 0;

GetOptions(
	'course=i' => \my $course_id,
	'seed:i' => $seed,
	'lang:s' => sub { $lang = int(uc($_[1]) eq 'EN'); },
	'help' => \my $help
) or pod2usage(2);
pod2usage(1) if $help;

my $horsedesc = shift @ARGV;

my $horse = decode_json(do { local(@ARGV, $/) = $horsedesc; <> });
my $skills = decode_json(do { local(@ARGV, $/) = "$FindBin::Bin/../data/skill_data.json"; <> });
my $skillnames = decode_json(do { local(@ARGV, $/) = "$FindBin::Bin/../data/skillnames.json"; <> });

my (%greens, %pinks, %golds, %whites, %uniques);

sub forall_effects (&@) {
	my $pred = \&{shift @_};
	my $skill = shift @_;

	all { all \&$pred, @{$_->{'effects'}} } @{$skill->{'alternatives'}};
}

sub to_range {
	my ($order_cond) = @_;
	my ($rate,$op,$eq,$pos);
	if ($order_cond =~ /continue/) {
		$rate = 1;
		$eq = 1;
		($op,$pos) = ($order_cond =~ /order_rate_(in|out)(\d+)_continue==1/);
		$op = $op eq 'in' ? '<' : '>';
	} else {
		($rate,$op,$eq,$pos) = ($order_cond =~ /order(_rate)?([><=])(=)?(\d+)/);
	}
	$pos = int(9 * ($pos / 100) + 0.5) if $rate;
	$pos += 1 - 2 * ($op eq '<') unless $eq;
	
	my @range;
	if ($op eq '<') {
		@range = (1,$pos);
	} elsif ($op eq '>') {
		@range = ($pos,9);
	} else {
		@range = ($pos,$pos);
	}
	\@range;
}

sub extract_order_ranges {
	my ($cond_str) = @_;
	my @ranges = map { to_range($_) } ($cond_str =~ /(order(?:_rate(?:_(?:in|out)\d+_continue)?)?[><=]=?\d+)/g);
	if (scalar(@ranges) == 0) {
		@ranges = ([1,9]);
	}
	\@ranges;
}

sub in_range {
	my ($x,$range) = @_;
	return $x >= $range->[0] && $x <= $range->[1];
}

sub merge_ranges {
	my ($a,$b) = @_;
	[max($a->[0],$b->[0]), min($a->[1],$b->[1])]
}

sub get_order_req {
	my ($cond) = @_;
	reduce { merge_ranges($a,$b) } @{extract_order_ranges($cond)};
}

sub range_matches {
	my ($range,$accept) = @_;
	any { in_range $_, $range } @$accept;
}

my $strategy = uc $horse->{'strategy'};
my @strategy_range;
if ($strategy eq 'OONIGE' || $strategy eq 'NIGE') {
	@strategy_range = 1..1;
} elsif ($strategy eq 'SENKOU') {
	@strategy_range = 1..4;
} else {
	@strategy_range = 6..9;
}

sub strategy_matches {
	my ($cond) = @_;
	return 1 unless $cond;
	any { range_matches $_, \@strategy_range } map { get_order_req($_) } split('@', $cond);
}

sub nige_reject {
	my ($cond) = @_;
	$cond && all { $_ =~ /change_order_onetime<0/ } split('@', $cond);
}

my @BLACKLIST_ALL = (910071, 200333, 200343, 202303, 201081);

foreach my $id (keys %$skills) {
	next if any { $id == $_ } @BLACKLIST_ALL;

	my $rarity = $skills->{$id}->{'rarity'};
	my $type0 = $skills->{$id}->{'alternatives'}->[0]->{'effects'}->[0]->{'type'};

	next if forall_effects { $_->{'type'} == 9 } $skills->{$id};

	next unless any {
		strategy_matches($_->{'precondition'}) && strategy_matches($_->{'condition'})
	} @{$skills->{$id}->{'alternatives'}};

	if (any { $type0 == $_ } (1,3,4)) {
		if (forall_effects { $_->{'modifier'} > 0 } $skills->{$id}) {
			$greens{$id} = $skills->{$id};
		}
	} elsif ($rarity == 6) {
		$pinks{$id} = $skills->{$id};
	} elsif ($rarity == 2) {
		$golds{$id} = $skills->{$id};
	} elsif (substr($id, 0, 1) == 9) {
		next if ($strategy eq 'OONIGE' || $strategy eq 'NIGE') && all { nige_reject($_->{'precondition'}) || nige_reject($_->{'condition'}) } @{$skills->{$id}->{'alternatives'}};
		$uniques{$id} = $skills->{$id};
	} elsif ($rarity == 1) {
		$whites{$id} = $skills->{$id};
	}
}

sub calc_rows {
	my ($group, $args) = @_;
	my @rows = sort { $b->[4] cmp $a->[4] } grep { $_->[2] > 0 } map {
		my $csv = `node tools/gain.js -c $course_id $horsedesc -s $_ --seed $seed $args --csv`;
		if ($?) {
			$csv = '0,0,0,0,0,0,0,0,null';
		} else {
			chomp $csv;
		}
		my @row = map { looks_like_number($_) ? max($_,0.0) : $_ } split ',', $csv;
		unshift @row, $_;
		\@row;
	} keys %$group;
	\@rows;
}

say 'バ身,スキル,,,,,,';
my $green_rows = calc_rows \%greens, '--nsamples 1';
foreach my $row (@$green_rows) {
	say $row->[1] . ',' . $skillnames->{$row->[0]}->[$lang] . ',,,,,,';
}

sub say_rows {
	my ($threshold_cols, $rows) = @_;

	say "平均,スキル,最小,中央,最大,$threshold_cols";
	foreach my $row (@$rows) {
		my $mark = $row->[8] eq 'ErlangRandomPolicy' ? '＊' : '';
		say $row->[4] . ',' . $skillnames->{$row->[0]}->[$lang] . $mark . ',' . $row->[1] . ',' . $row->[3] . ',' . $row->[2] . ',' . $row->[5] . ',' . $row->[6] . ',' . $row->[7];
	}
}

say '';
say_rows '≥1.00,≥2.00,≥3.00', calc_rows(\%pinks, '--nsamples 300 --thresholds 1,2,3');

say '';
say_rows '≥1.00,≥2.00,≥3.00', calc_rows(\%golds, '--nsamples 300 --thresholds 1,2,3');

say '';
say_rows '≥0.50,≥1.00,≥1.50', calc_rows(\%whites, '--nsamples 300 --thresholds 0.5,1,1.5');

say '';
say_rows '≥0.50,≥1.00,≥1.50', calc_rows(\%uniques, '--nsamples 300 --thresholds 0.5,1,1.5');

__END__

=head1 NAME

tabulateskills.pl - Test all skills and produce CSV

=head1 SYNOPSIS

perl tabulateskills.pl --course course_id horse.json

 Options:
   --course <course id>		id of course to test
   --seed [seed]			shared seed for all skill tests
   --lang [en|jp]			output language for skill names
   --help					shows this message

 Arguments:
   horse.json		path to horse description json file
