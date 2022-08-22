use strict;
use warnings;
use v5.012;
use utf8;
use open qw(:encoding(UTF-8));
binmode(STDOUT, ':encoding(UTF-8)');

use Mojo::DOM;
use JSON::PP;

my $filename = shift @ARGV;
my $dom = Mojo::DOM->new(do { local(@ARGV, $/) = $filename; <> });

my $skills = {};

for my $row ($dom->find('[class^=skills_table_row]')->each) {
	if ($row->at('[class^=skills_table_desc]')->text =~ /\((\d+)\)/) {
		my $id = $1;
		my $enname = $row->at('[class^=skills_table_enname]')->text;
		my $jpname = $row->at('[class^=skills_table_jpname]')->text;
		$skills->{$id} = [$jpname,$enname];
		if ($id =~ /^1(\d+)/) {  # add inherited versions of uniques
			$skills->{'9' . $1} = [$jpname . '（継承）',$enname . ' (inherited)'];
		}
	}
}

my $json = JSON::PP->new;
$json->canonical(1);
say $json->encode($skills);
