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

/**
 * Created by jrobinso on 4/7/14.
 */


var igv = (function (igv) {

    var BIGWIG_MAGIC_LTH = 0x888FFC26; // BigWig Magic Low to High
    var BIGWIG_MAGIC_HTL = 0x26FC8F66; // BigWig Magic High to Low
    var BIGBED_MAGIC_LTH = 0x8789F2EB; // BigBed Magic Low to High
    var BIGBED_MAGIC_HTL = 0xEBF28987; // BigBed Magic High to Low
    var BBFILE_HEADER_SIZE = 64;
    var RPTREE_HEADER_SIZE = 48;
    var RPTREE_NODE_LEAF_ITEM_SIZE = 32;   // leaf item size
    var RPTREE_NODE_CHILD_ITEM_SIZE = 24;  // child item size
    var BUFFER_SIZE = 512000;     //  buffer
    var BPTREE_HEADER_SIZE = 32;

    igv.BWReader = function (config) {
        this.path = config.url;
        this.headPath = config.headURL || this.path;
        this.rpTreeCache = {};
        this.config = config;
    };

    igv.BWReader.prototype.readWGFeatures = function (genome, bpPerPixel, windowFunction) {

        var self = this;
        return self.getZoomHeaders()
            .then(function (zoomLevelHeaders) {
                var chrIdx1, chrIdx2, chr1, chr2;

                chrIdx1 = 0;
                chrIdx2 = self.chromTree.idToChrom.length - 1;
                chr1 = self.chromTree.idToChrom[chrIdx1];
                chr2 = self.chromTree.idToChrom[chrIdx2];

                return self.readFeatures(chr1, 0, chr2, Number.MAX_VALUE, bpPerPixel, windowFunction);
            });

    }

    igv.BWReader.prototype.readFeatures = function (chr1, bpStart, chr2, bpEnd, bpPerPixel, windowFunction) {

        var self = this,
            decodeFunction,
            chrIdx1,
            chrIdx2,
            bufferedReader = new igv.BufferedReader(self.config);

        return self.getZoomHeaders()

            .then(function (zoomLevelHeaders) {

                // Select a biwig "zoom level" appropriate for the current resolution
                var zoomLevelHeader = zoomLevelForScale(bpPerPixel, zoomLevelHeaders),
                    treeOffset;

                if (zoomLevelHeader) {
                    treeOffset = zoomLevelHeader.indexOffset;
                    decodeFunction = decodeZoomData;
                } else {
                    treeOffset = self.header.fullIndexOffset;
                    if (self.type === "BigWig") {
                        decodeFunction = decodeWigData;
                    }
                    else {
                        decodeFunction = decodeBedData;
                    }
                }

                return self.loadRPTree(treeOffset);
            })

            .then(function (rpTree) {

                chrIdx1 = self.chromTree.chromToID[chr1];
                chrIdx2 = self.chromTree.chromToID[chr2];
                if (chrIdx1 === undefined || chrIdx2 === undefined) {
                    return undefined;
                }
                else {
                    return rpTree.findLeafItemsOverlapping(chrIdx1, bpStart, chrIdx2, bpEnd)
                }
            })

            .then(function (leafItems) {

                var promises = [];

                if (!leafItems || leafItems.length == 0) {
                    return [];
                }
                else {
                    leafItems.forEach(function (item) {

                        promises.push(
                            bufferedReader.dataViewForRange({
                                start: item.dataOffset,
                                size: item.dataSize
                            }, true)
                                .then(function (uint8Array) {
                                    var features = [];
                                    var inflate = new Zlib.Inflate(uint8Array);
                                    var plain = inflate.decompress();
                                    decodeFunction(new DataView(plain.buffer), chrIdx1, bpStart, chrIdx2, bpEnd, features, self.chromTree.idToChrom, windowFunction);
                                    return features;
                                })
                        )
                    });

                    return Promise.all(promises);
                }
            })

            .then(function (featureArrays) {

                var i, allFeatures = [];


                allFeatures = allFeatures.concat.apply(allFeatures, featureArrays);

                // for (i = 0; i < featureArrays.length; i++) {
                //     allFeatures = allFeatures.concat(featureArrays[i]);
                // }

                allFeatures.sort(function (a, b) {
                    return a.start - b.start;
                });

                return allFeatures;
            })
    }

    igv.BWReader.prototype.getZoomHeaders = function () {

        var self = this;

        if (self.zoomLevelHeaders) {
            return Promise.resolve(self.zoomLevelHeaders);
        }
        else {
            return self.loadHeader()
                .then(function () {
                    return self.zoomLevelHeaders;
                })
        }

    }

    igv.BWReader.prototype.loadHeader = function () {

        var self = this;

        return igv.xhr.loadArrayBuffer(self.path, igv.buildOptions(self.config, {
            range: {
                start: 0,
                size: BBFILE_HEADER_SIZE
            }
        }))
            .then(function (data) {

                var header;

                // Assume low-to-high unless proven otherwise
                self.littleEndian = true;

                var binaryParser = new igv.BinaryParser(new DataView(data));

                var magic = binaryParser.getUInt();

                if (magic === BIGWIG_MAGIC_LTH) {
                    self.type = "BigWig";
                }
                else if (magic == BIGBED_MAGIC_LTH) {
                    self.type = "BigBed";
                }
                else {
                    //Try big endian order
                    self.littleEndian = false;

                    binaryParser.littleEndian = false;
                    binaryParser.position = 0;
                    var magic = binaryParser.getUInt();

                    if (magic === BIGWIG_MAGIC_HTL) {
                        self.type = "BigWig";
                    }
                    else if (magic == BIGBED_MAGIC_HTL) {
                        self.type = "BigBed";
                    }
                    else {
                        // TODO -- error, unknown file type  or BE
                    }
                }
                // Table 5  "Common header for BigWig and BigBed files"
                header = {};
                header.bwVersion = binaryParser.getUShort();
                header.nZoomLevels = binaryParser.getUShort();
                header.chromTreeOffset = binaryParser.getLong();
                header.fullDataOffset = binaryParser.getLong();
                header.fullIndexOffset = binaryParser.getLong();
                header.fieldCount = binaryParser.getUShort();
                header.definedFieldCount = binaryParser.getUShort();
                header.autoSqlOffset = binaryParser.getLong();
                header.totalSummaryOffset = binaryParser.getLong();
                header.uncompressBuffSize = binaryParser.getInt();
                header.reserved = binaryParser.getLong();

                return header;

            })

            .then(function (header) {

                self.header = header;

                return loadZoomHeadersAndChrTree.call(self);

            })


        function loadZoomHeadersAndChrTree() {

            var startOffset = BBFILE_HEADER_SIZE,
                self = this;

            var range = {start: startOffset, size: (self.header.fullDataOffset - startOffset + 5)};

            return igv.xhr.loadArrayBuffer(self.path, igv.buildOptions(self.config, {range: range}))
                .then(function (data) {

                    var nZooms = self.header.nZoomLevels,
                        binaryParser = new igv.BinaryParser(new DataView(data)),
                        i,
                        len,
                        zoomNumber,
                        zlh;

                    self.zoomLevelHeaders = [];

                    self.firstZoomDataOffset = Number.MAX_VALUE;
                    for (i = 1; i <= nZooms; i++) {
                        zoomNumber = nZooms - i;
                        zlh = new ZoomLevelHeader(zoomNumber, binaryParser);
                        self.firstZoomDataOffset = Math.min(zlh.dataOffset, self.firstZoomDataOffset);
                        self.zoomLevelHeaders[zoomNumber] = zlh;
                    }

                    // Autosql
                    if (self.header.autoSqlOffset > 0) {
                        binaryParser.position = self.header.autoSqlOffset - startOffset;
                        self.autoSql = binaryParser.getString();
                    }

                    // Total summary
                    if (self.header.totalSummaryOffset > 0) {
                        binaryParser.position = self.header.totalSummaryOffset - startOffset;
                        self.totalSummary = new BWTotalSummary(binaryParser);
                    }

                    // Chrom data index
                    if (self.header.chromTreeOffset > 0) {
                        binaryParser.position = self.header.chromTreeOffset - startOffset;
                        self.chromTree = new BPTree(binaryParser, startOffset);
                    }
                    else {
                        // TODO -- this is an error, not expected
                    }

                    //Finally total data count
                    binaryParser.position = self.header.fullDataOffset - startOffset;
                    self.dataCount = binaryParser.getInt();

                    return self.header;

                })
        }

    }

    igv.BWReader.prototype.loadRPTree = function (offset) {

        var self = this;

        var rpTree = self.rpTreeCache[offset];
        if (rpTree) {
            return Promise.resolve(rpTree);
        }
        else {
            rpTree = new RPTree(offset, self.contentLength, self.config, self.littleEndian);
            self.rpTreeCache[offset] = rpTree;
            return rpTree.load();
        }
    }

    function ZoomLevelHeader(index, byteBuffer) {
        this.index = index;
        this.reductionLevel = byteBuffer.getInt();
        this.reserved = byteBuffer.getInt();
        this.dataOffset = byteBuffer.getLong();
        this.indexOffset = byteBuffer.getLong();

    }

    function RPTree(fileOffset, contentLength, config, littleEndian) {

        this.config = config;
        this.filesize = contentLength;
        this.fileOffset = fileOffset; // File offset to beginning of tree
        this.path = config.url;
        this.littleEndian = littleEndian;
    }

    RPTree.prototype.load = function () {

        var self = this;

        var rootNodeOffset = self.fileOffset + RPTREE_HEADER_SIZE,
            bufferedReader = new igv.BufferedReader(self.config, self.filesize, BUFFER_SIZE);

        return self.readNode(rootNodeOffset, bufferedReader)

            .then(function (node) {
                self.rootNode = node;
                return self;
            })
    }

    RPTree.prototype.readNode = function (filePosition, bufferedReader) {

        var self = this;


        var count, isLeaf;

        return bufferedReader.dataViewForRange({start: filePosition, size: 4}, false)

            .then(function (dataView) {
                var binaryParser, type, reserved;

                binaryParser = new igv.BinaryParser(dataView, self.littleEndian);
                type = binaryParser.getByte();
                isLeaf = (type === 1) ? true : false;
                reserved = binaryParser.getByte();
                count = binaryParser.getUShort();

                filePosition += 4;

                var bytesRequired = count * (isLeaf ? RPTREE_NODE_LEAF_ITEM_SIZE : RPTREE_NODE_CHILD_ITEM_SIZE);
                var range2 = {start: filePosition, size: bytesRequired};

                return bufferedReader.dataViewForRange(range2, false);
            })

            .then(function (dataView) {

                var i,
                    items = new Array(count),
                    binaryParser = new igv.BinaryParser(dataView);

                if (isLeaf) {
                    for (i = 0; i < count; i++) {
                        var item = {
                            isLeaf: true,
                            startChrom: binaryParser.getInt(),
                            startBase: binaryParser.getInt(),
                            endChrom: binaryParser.getInt(),
                            endBase: binaryParser.getInt(),
                            dataOffset: binaryParser.getLong(),
                            dataSize: binaryParser.getLong()
                        };
                        items[i] = item;

                    }
                    return new RPTreeNode(items);
                }
                else { // non-leaf
                    for (i = 0; i < count; i++) {

                        var item = {
                            isLeaf: false,
                            startChrom: binaryParser.getInt(),
                            startBase: binaryParser.getInt(),
                            endChrom: binaryParser.getInt(),
                            endBase: binaryParser.getInt(),
                            childOffset: binaryParser.getLong()
                        };
                        items[i] = item;

                    }

                    return new RPTreeNode(items);
                }
            })
    }

    RPTree.prototype.findLeafItemsOverlapping = function (chrIdx1, startBase, chrIdx2, endBase) {

        var self = this;

        return new Promise(function (fulfill, reject) {

            var leafItems = [],
                processing = new Set(),
                bufferedReader = new igv.BufferedReader(self.config, self.filesize, BUFFER_SIZE);

            processing.add(0);  // Zero represents the root node
            findLeafItems(self.rootNode, 0);

            function findLeafItems(node, nodeId) {

                if (overlaps(node, chrIdx1, startBase, chrIdx2, endBase)) {

                    var items = node.items;

                    items.forEach(function (item) {

                        if (overlaps(item, chrIdx1, startBase, chrIdx2, endBase)) {

                            if (item.isLeaf) {
                                leafItems.push(item);
                            }

                            else {
                                if (item.childNode) {
                                    findLeafItems(item.childNode);
                                }
                                else {
                                    processing.add(item.childOffset);  // Represent node to-be-loaded by its file position

                                    self.readNode(item.childOffset, bufferedReader)
                                        .then(function (node) {
                                            item.childNode = node;
                                            findLeafItems(node, item.childOffset);
                                        })
                                        .catch(reject);
                                }
                            }
                        }
                    });

                }

                if (nodeId != undefined) processing.delete(nodeId);

                // Wait until all nodes are processed
                if (processing.size === 0) {
                    fulfill(leafItems);
                }
            }
        });
    }

    function RPTreeNode(items) {


        this.items = items;

        var minChromId = Number.MAX_VALUE,
            maxChromId = 0,
            minStartBase = Number.MAX_VALUE,
            maxEndBase = 0,
            i,
            item;

        for (i = 0; i < items.length; i++) {
            item = items[i];
            minChromId = Math.min(minChromId, item.startChrom);
            maxChromId = Math.max(maxChromId, item.endChrom);
            minStartBase = Math.min(minStartBase, item.startBase);
            maxEndBase = Math.max(maxEndBase, item.endBase);
        }

        this.startChrom = minChromId;
        this.endChrom = maxChromId;
        this.startBase = minStartBase;
        this.endBase = maxEndBase;

    }

    function BPTree(binaryParser, startOffset) {

        var self = this,
            genome = igv.browser ? igv.browser.genome : null;

        var magic = binaryParser.getInt();
        var blockSize = binaryParser.getInt();
        var keySize = binaryParser.getInt();
        var valSize = binaryParser.getInt();
        var itemCount = binaryParser.getLong();
        var reserved = binaryParser.getLong();
        var chromToId = {};
        var idToChrom = [];

        this.chromToID = chromToId;
        this.idToChrom = idToChrom;

        // Recursively walk tree to populate dictionary
        readTreeNode(binaryParser, -1);


        function readTreeNode(byteBuffer, offset) {

            if (offset >= 0) byteBuffer.position = offset;

            var type = byteBuffer.getByte(),
                reserved = byteBuffer.getByte(),
                count = byteBuffer.getUShort(),
                i,
                key,
                chromId,
                chromSize,
                childOffset,
                bufferOffset,
                currOffset;


            if (type == 1) {

                for (i = 0; i < count; i++) {

                    key = byteBuffer.getFixedLengthTrimmedString(keySize);
                    chromId = byteBuffer.getInt();
                    chromSize = byteBuffer.getInt();

                    if (genome) key = genome.getChromosomeName(key);  // Translate to canonical chr name
                    chromToId[key] = chromId;
                    idToChrom[chromId] = key;

                }
            }
            else { // non-leaf

                for (i = 0; i < count; i++) {

                    key = byteBuffer.getFixedLengthTrimmedString(keySize);
                    childOffset = byteBuffer.getLong();
                    bufferOffset = childOffset - startOffset;
                    currOffset = byteBuffer.position;
                    readTreeNode(byteBuffer, bufferOffset);
                    byteBuffer.position = currOffset;
                }
            }

        }
    }

    /**
     * Return true if {chrIdx1:startBase-chrIdx2:endBase} overlaps item's interval
     * @returns {boolean}
     */
    function overlaps(item, chrIdx1, startBase, chrIdx2, endBase) {

        if (!item) {
            console.log("null item");
            return false;
        }

        return ((chrIdx2 > item.startChrom) || (chrIdx2 == item.startChrom && endBase >= item.startBase)) &&
            ((chrIdx1 < item.endChrom) || (chrIdx1 == item.endChrom && startBase <= item.endBase));


    }

    function BWTotalSummary(byteBuffer) {

        if (byteBuffer) {

            this.basesCovered = byteBuffer.getLong();
            this.minVal = byteBuffer.getDouble();
            this.maxVal = byteBuffer.getDouble();
            this.sumData = byteBuffer.getDouble();
            this.sumSquares = byteBuffer.getDouble();

            computeStats.call(this);
        }
        else {
            this.basesCovered = 0;
            this.minVal = 0;
            this.maxVal = 0;
            this.sumData = 0;
            this.sumSquares = 0;
            this.mean = 0;
            this.stddev = 0;
        }
    }


    BWTotalSummary.prototype.updateStats = function (stats) {

        this.basesCovered += stats.count;
        this.sumData += status.sumData;
        this.sumSquares += sumSquares;
        this.minVal = MIN(_minVal, min);
        this.maxVal = MAX(_maxVal, max);

        computeStats.call(this);

    }

    function computeStats() {
        var n = this.basesCovered;
        if (n > 0) {
            this.mean = this.sumData / n;
            this.stddev = Math.sqrt(this.sumSquares / (n - 1));

            var min = this.minVal < 0 ? this.mean - 2 * this.stddev : 0,
                max = this.maxVal > 0 ? this.mean + 2 * this.stddev : 0;

            this.defaultRange = {
                min: 0,
                max: this.mean + 3 * this.stddev
            }
        }
    }

    function zoomLevelForScale(bpPerPixel, zoomLevelHeaders) {

        var level = null, i, zl;

        for (i = 0; i < zoomLevelHeaders.length; i++) {

            zl = zoomLevelHeaders[i];

            if (zl.reductionLevel < bpPerPixel) {
                level = zl;
                break;
            }
        }

        return level;
    }

    function decodeWigData(data, chrIdx1, bpStart, chrIdx2, bpEnd, featureArray, chrDict) {

        var binaryParser = new igv.BinaryParser(data),
            chromId = binaryParser.getInt(),
            chromStart = binaryParser.getInt(),
            chromEnd = binaryParser.getInt(),
            itemStep = binaryParser.getInt(),
            itemSpan = binaryParser.getInt(),
            type = binaryParser.getByte(),
            reserved = binaryParser.getByte(),
            itemCount = binaryParser.getUShort(),
            value,
            chr;

        if (chromId >= chrIdx1 && chromId <= chrIdx2) {

            while (itemCount-- > 0) {

                switch (type) {
                    case 1:
                        chromStart = binaryParser.getInt();
                        chromEnd = binaryParser.getInt();
                        value = binaryParser.getFloat();
                        break;
                    case 2:
                        chromStart = binaryParser.getInt();
                        value = binaryParser.getFloat();
                        chromEnd = chromStart + itemSpan;
                        break;
                    case 3:  // Fixed step
                        value = binaryParser.getFloat();
                        chromEnd = chromStart + itemSpan;
                        chromStart += itemStep;
                        break;

                }

                if (chromId < chrIdx1 || (chromId === chrIdx1 && chromEnd < bpStart)) continue;
                else if (chromId > chrIdx2 || (chromId === chrIdx2 && chromStart >= bpEnd))  break;

                if (Number.isFinite(value)) {
                    chr = chrDict[chromId];
                    featureArray.push({chr: chr, start: chromStart, end: chromEnd, value: value});

                }
            }
        }

    }


    function decodeBedData(data, chrIdx1, bpStart, chrIdx2, bpEnd, featureArray, chrDict) {

        var binaryParser = new igv.BinaryParser(data),
            minSize = 3 * 4 + 1,   // Minimum # of bytes required for a bed record
            chromId,
            chromStart,
            chromEnd,
            rest,
            tokens,
            feature,
            exonCount, exonSizes, exonStarts, exons, eStart, eEnd, chr;


        while (binaryParser.remLength() >= minSize) {

            chromId = binaryParser.getInt();
            chr = chrDict[chromId];
            chromStart = binaryParser.getInt();
            chromEnd = binaryParser.getInt();
            rest = binaryParser.getString();

            if (chromId < chrIdx1 || (chromId === chrIdx1 && chromEnd < bpStart)) continue;
            else if (chromId > chrIdx2 || (chromId === chrIdx2 && chromStart >= bpEnd))  break;


            feature = {chr: chr, start: chromStart, end: chromEnd};

            featureArray.push(feature);

            tokens = rest.split("\t");

            if (tokens.length > 0) {
                feature.name = tokens[0];
            }

            if (tokens.length > 1) {
                feature.score = parseFloat(tokens[1]);
            }
            if (tokens.length > 2) {
                feature.strand = tokens[2];
            }
            if (tokens.length > 3) {
                feature.cdStart = parseInt(tokens[3]);
            }
            if (tokens.length > 4) {
                feature.cdEnd = parseInt(tokens[4]);
            }
            if (tokens.length > 5) {
                if (tokens[5] !== "." && tokens[5] !== "0")
                    feature.color = igv.createColorString(tokens[5]);
            }
            if (tokens.length > 8) {
                exonCount = parseInt(tokens[6]);
                exonSizes = tokens[7].split(',');
                exonStarts = tokens[8].split(',');
                exons = [];

                for (var i = 0; i < exonCount; i++) {
                    eStart = start + parseInt(exonStarts[i]);
                    eEnd = eStart + parseInt(exonSizes[i]);
                    exons.push({start: eStart, end: eEnd});
                }

                feature.exons = exons;
            }

        }

    }


    function decodeZoomData(data, chrIdx1, bpStart, chrIdx2, bpEnd, featureArray, chrDict, windowFunction) {

        var binaryParser = new igv.BinaryParser(data),
            minSize = 8 * 4,   // Minimum # of bytes required for a zoom record
            chromId,
            chromStart,
            chromEnd,
            validCount,
            minVal,
            maxVal,
            sumData,
            sumSquares,
            value,
            chr;

        while (binaryParser.remLength() >= minSize) {

            chromId = binaryParser.getInt();
            chr = chrDict[chromId];
            chromStart = binaryParser.getInt();
            chromEnd = binaryParser.getInt();

            if (chromId < chrIdx1 || (chromId === chrIdx1 && chromEnd < bpStart)) continue;
            if (chromId > chrIdx2 || (chromId === chrIdx2 && chromStart >= bpEnd)) break;


            validCount = binaryParser.getInt();
            minVal = binaryParser.getFloat();
            maxVal = binaryParser.getFloat();
            sumData = binaryParser.getFloat();
            sumSquares = binaryParser.getFloat();
            switch (windowFunction) {
                case "min":
                    value = minVal;
                    break;
                case "max":
                    value = maxVal;
                    break;
                default:
                    value = validCount == 0 ? 0 : sumData / validCount;
            }


            if (Number.isFinite(value)) {
                featureArray.push({chr: chr, start: chromStart, end: chromEnd, value: value});


            }
        }
    }

    return igv;


})
(igv || {});
