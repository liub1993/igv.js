/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2014 Broad Institute
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

var igv = (function (igv) {


    igv.BamSource = function (config) {

        this.config = config;
        this.alignmentContainer = undefined;
        this.maxRows = config.maxRows || 1000;

        if ("ga4gh" === config.sourceType) {
            this.bamReader = new igv.Ga4ghAlignmentReader(config);
        } else if ("pysam" === config.sourceType) {
            this.bamReader = new igv.BamWebserviceReader(config)
        } else if("htsget" === config.sourceType) {
            this.bamReader = new igv.HtsgetReader(config);
        } else {
            this.bamReader = new igv.BamReader(config);
        }

        this.viewAsPairs = config.viewAsPairs;
    };

    igv.BamSource.prototype.setViewAsPairs = function (bool) {
        var self = this;

        if (this.viewAsPairs !== bool) {
            this.viewAsPairs = bool;
            // TODO -- repair alignments
            if (this.alignmentContainer) {
                var alignmentContainer = this.alignmentContainer,
                    alignments;

                if (bool) {
                    alignments = pairAlignments(alignmentContainer.packedAlignmentRows);
                }
                else {
                    alignments = unpairAlignments(alignmentContainer.packedAlignmentRows);
                }
                alignmentContainer.packedAlignmentRows = packAlignmentRows(alignments, alignmentContainer.start, alignmentContainer.end, self.maxRows);

            }
        }
    };

    igv.BamSource.prototype.getAlignments = function (chr, bpStart, bpEnd) {

        var self = this;

        if (self.alignmentContainer && self.alignmentContainer.contains(chr, bpStart, bpEnd)) {
            return Promise.resolve(self.alignmentContainer);
        } else {
            return new Promise(function (fulfill, reject) {


                self.bamReader.readAlignments(chr, bpStart, bpEnd).then(function (alignmentContainer) {

                    var maxRows = self.config.maxRows || 500,
                        alignments = alignmentContainer.alignments;

                    if (!self.viewAsPairs) {
                        alignments = unpairAlignments([{alignments: alignments}]);
                    }

                    alignmentContainer.packedAlignmentRows = packAlignmentRows(alignments, alignmentContainer.start, alignmentContainer.end, maxRows);


                    alignmentContainer.alignments = undefined;  // Don't need to hold onto these anymore
                    self.alignmentContainer = alignmentContainer;

                    igv.browser.genome.sequence.getSequence(alignmentContainer.chr, alignmentContainer.start, alignmentContainer.end).then(
                        function (sequence) {


                            if (sequence) {

                                alignmentContainer.coverageMap.refSeq = sequence;    // TODO -- fix this
                                alignmentContainer.sequence = sequence;           // TODO -- fix this


                                fulfill(alignmentContainer);
                            }
                        }).catch(reject);

                }).catch(reject);

            });
        }
    }

    function pairAlignments(rows) {

        var pairCache = {},
            result = [];

        rows.forEach(function (row) {

            row.alignments.forEach(function (alignment) {

                var pairedAlignment;

                if (canBePaired(alignment)) {

                    pairedAlignment = pairCache[alignment.readName];
                    if (pairedAlignment) {
                        pairedAlignment.setSecondAlignment(alignment);
                        pairCache[alignment.readName] = undefined;   // Don't need to track this anymore.
                    }
                    else {
                        pairedAlignment = new igv.PairedAlignment(alignment);
                        pairCache[alignment.readName] = pairedAlignment;
                        result.push(pairedAlignment);
                    }
                }

                else {
                    result.push(alignment);
                }
            });
        });
        return result;
    }

    function unpairAlignments(rows) {
        var result = [];
        rows.forEach(function (row) {
            row.alignments.forEach(function (alignment) {
                if (alignment instanceof igv.PairedAlignment) {
                    if (alignment.firstAlignment) result.push(alignment.firstAlignment);  // shouldn't need the null test
                    if (alignment.secondAlignment) result.push(alignment.secondAlignment);

                }
                else {
                    result.push(alignment);
                }
            });
        });
        return result;
    }

    function canBePaired(alignment) {
        return alignment.isPaired() &&
            alignment.isMateMapped() &&
            alignment.chr === alignment.mate.chr &&
            (alignment.isFirstOfPair() || alignment.isSecondOfPair()) && !(alignment.isSecondary() || alignment.isSupplementary());
    }

    function packAlignmentRows(alignments, start, end, maxRows) {

        if (!alignments) return;

        alignments.sort(function (a, b) {
            return a.start - b.start;
        });

        if (alignments.length === 0) {

            return [];

        } else {

            var bucketList = [],
                allocatedCount = 0,
                lastAllocatedCount = 0,
                nextStart,
                alignmentRow,
                index,
                bucket,
                alignment,
                alignmentSpace = 4 * 2,
                packedAlignmentRows = [],
                bucketStart;

            bucketStart = Math.max(start, alignments[0].start);
            nextStart = bucketStart;

            alignments.forEach(function (alignment) {

                var buckListIndex = Math.max(0, alignment.start - bucketStart);
                if (bucketList[buckListIndex] === undefined) {
                    bucketList[buckListIndex] = [];
                }
                bucketList[buckListIndex].push(alignment);
            });


            while (allocatedCount < alignments.length && packedAlignmentRows.length < maxRows) {

                alignmentRow = new igv.BamAlignmentRow();

                while (nextStart <= end) {

                    bucket = undefined;

                    while (!bucket && nextStart <= end) {

                        index = nextStart - bucketStart;
                        if (bucketList[index] === undefined) {
                            ++nextStart;                     // No alignments at this index
                        } else {
                            bucket = bucketList[index];
                        }

                    } // while (bucket)

                    if (!bucket) {
                        break;
                    }
                    alignment = bucket.pop();
                    if (0 === bucket.length) {
                        bucketList[index] = undefined;
                    }

                    alignmentRow.alignments.push(alignment);
                    nextStart = alignment.start + alignment.lengthOnRef + alignmentSpace;
                    ++allocatedCount;

                } // while (nextStart)

                if (alignmentRow.alignments.length > 0) {
                    packedAlignmentRows.push(alignmentRow);
                }

                nextStart = bucketStart;

                if (allocatedCount === lastAllocatedCount) break;   // Protect from infinite loops

                lastAllocatedCount = allocatedCount;

            } // while (allocatedCount)

            return packedAlignmentRows;
        }
    }

    return igv;

})(igv || {});
