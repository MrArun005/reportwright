#!/bin/sh
# Eclipse BIRT runtime (EPL-2.0), the report-generation peer (bench/deep/README.md). Not on Maven Central past 4.9, so
# the pinned runtime zip is downloaded from eclipse.org and checked against its published sha512; its ReportEngine/lib
# is the classpath (BIRT's POJO runtime). Run: java -cp target/classes:runtime/lib/* bench.Birt birt <job> ...
set -eu
cd "$(dirname "$0")"
V=4.25.0 B=202609090532
SHA=f064d898edb2a8a2bcaabb11524d34feeaaa24ad3e8f2d83dde5a8af0d3ea9d92a777df48f19e08b213cece0beb63a5d820d9219e8f7a6463484e318cc128ff7
if [ ! -d runtime/lib ]; then
  Z=$(mktemp)
  curl -fsSL --retry 3 -o "$Z" "https://download.eclipse.org/birt/updates/release/$V/downloads/birt-runtime-$V-$B.zip"
  echo "$SHA  $Z" | sha512sum -c -
  mkdir -p runtime && unzip -q -j "$Z" 'ReportEngine/lib/*' -d runtime/lib
  rm -f "$Z"
fi
mkdir -p target/classes
javac --release 21 -nowarn -d target/classes -cp 'runtime/lib/*' ../frame/bench/Frame.java src/bench/Birt.java
cp resources/ledger.rptdesign target/classes/
