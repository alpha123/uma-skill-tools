use strict;
use warnings;
use v5.012;
use utf8;
use open qw(:encoding(UTF-8));
binmode(STDOUT, ':encoding(UTF-8)');

use JSON::PP;

my $json = JSON::PP->new;
$json->canonical(1);

my $filename = shift @ARGV;
my $names = $json->decode(do { local(@ARGV, $/) = $filename; <> });

my $skills = {};

for my $skill (@$names) {
	my $id = $skill->{id};
	my $enname = $skill->{name_en};
	my $jpname = $skill->{name_ja};

	if ($id eq '100701') {  # Seirios
		$skills->{'100701-1'} = [$jpname . '（人気4番以下）', $enname . ' (popularity 4 or lower)'];
		$skills->{'900701-1'} = [$jpname . '（人気4番以下）（継承）', $enname . ' (popularity 4 or lower) (inherited)'];
		$jpname .= '（人気1～3番）';
		$enname .= ' (popularity 1-3)';
	}

	$skills->{$id} = [$jpname,$enname];
	if ($id =~ /^1(\d+)/) {  # add inherited versions of uniques
		$skills->{'9' . $1} = [$jpname . '（継承）',$enname . ' (inherited)'];
	}
}

say $json->encode($skills);
