function bamIndexTests() {

    if (!igv) igv = {};
    igv.sequenceSource = new igv.FastaSequence("//igvdata.broadinstitute.org/genomes/seq/hg19/hg19.fasta");

//
//    asyncTest("index", function () {
//
//        var bamPath = "../test/data/bam/gstt1_sample.bam",
//            bamFile = new igv.BamReader(bamPath, null);
//
//        bamFile.readIndex(function () {
//
//            equal(15, bamFile.indices.length, "bamFile.indices.length");
//
//            var index = bamFile.indices[14];
//            console.log("index-14 " + index);
//            start();
//        })
//
//    });

    asyncTest("blocksForRange", 4, function () {

        var refID = 14,
            beg = 24375199,
            end = 24378544,
            indexPath = "../test/data/bam/gstt1_sample.bam.bai";

        igv.loadBamIndex(indexPath, function (bamIndex) {

            bamIndex.blocksForRange(refID, beg, end, function (chunks) {

                ok(chunks, "chunks are non-null");
                equal(chunks.length, 1, "chunks.length is correct");

                var chunk = chunks[0];
                equal(0, chunk.maxv.offset, "chunk.maxv.offset");
                equal(60872, chunk.maxv.block, "chunk.maxv.block");

                start();
            });
        });
    });


//
//    asyncTest("blocksForRange 1kg", function () {
//
//        var refID = 0,
//            beg = 155168191,
//            end = 155170311,
//            bamPath = "//www.broadinstitute.org/igvdata/1KG/b37/data/HG02450/alignment/HG02450.mapped.ILLUMINA.bwa.ACB.low_coverage.20120522.bam",
//            bamFile = new igv.BamReader(bamPath, null);
//
//        bamFile.blocksForRange(refID, beg, end, function (chunks) {
//
//            ok(chunks, "chunks are non-null");
//            equal(chunks.length, 6, "chunks.length is correct");
//
//            var chunk = chunks[0];
//            equal(34768, chunk.minv.offset);
//            equal(884732468, chunk.minv.block);
//
//            equal(47405, chunk.maxv.offset);
//            equal(884831373, chunk.maxv.block);
//
//            chunk = chunks[5];
//            equal(33278, chunk.minv.offset);
//            equal(1082533645, chunk.minv.block);
//
//            equal(36171, chunk.maxv.offset);
//            equal(1082533645, chunk.maxv.block);
//
//            start();
//        })
//    });


}


