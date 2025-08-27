use strict;
use warnings;
use v5.012;
use utf8;
use open qw(:encoding(UTF-8));
binmode(STDOUT, ':encoding(UTF-8)');

use DBI;
use DBD::SQLite::Constants qw(:file_open);
use JSON::PP;
use Encoding qw(encode decode);

my $json = JSON::PP->new;
$json->canonical(1);

my $mastermdb = shift @ARGV;
my $filename = shift @ARGV;
my $names = $json->decode(do { local(@ARGV, $/) = $filename; <> });

my $db = DBI->connect("dbi:SQLite:$mastermdb", undef, undef, {
	sqlite_open_flags => SQLITE_OPEN_READONLY
});
$db->{RaiseError} = 1;

my $select = $db->prepare('SELECT [index], text FROM text_data WHERE category = 47;');

$select->execute;

my ($id, $utf8name);

$select->bind_columns(\($id, $utf8name));

my $skills = {};

my %ennames;
for my $skill (@$names) {
	$ennames{$skill->{id}} = $skill->{name_en};
}

while ($select->fetch) {
	my $jpname = Encode::decode('utf8', $utf8name);
	my $enname = $ennames{$id} || '';

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
