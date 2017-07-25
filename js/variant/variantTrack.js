/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2016 University of California San Diego
 * Author: Jim Robinson
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
 * Created by jrobinson on 4/15/16.
 */

var igv = (function (igv) {

    var DEFAULT_VISIBILITY_WINDOW = 100000;

    igv.VariantTrack = function (config) {


        this.visibilityWindow = config.visibilityWindow === undefined ? 'compute' : config.visibilityWindow;

        igv.configTrack(this, config);

        this.displayMode = config.displayMode || "EXPANDED";    // COLLAPSED | EXPANDED | SQUISHED
        this.labelDisplayMode = config.labelDisplayMode;

        this.variantHeight = config.variantHeight || 20;
        this.squishedCallHeight = config.squishedCallHeight || 4;
        this.expandedCallHeight = config.expandedCallHeight || 20;
        this.expandedVGap = 4;
        this.squishedVGap = 1;

        this.featureHeight = config.featureHeight || 14;

        this.featureSource = new igv.FeatureSource(config);

        this.homrefColor = config.homrefColor || "rgb(200, 200, 200)"
        this.homvarColor = config.homvarColor || "rgb(17,248,254)";
        this.hetvarColor = config.hetvarColor || "rgb(34,12,253)";

        this.nRows = 1;  // Computed dynamically
    };


    igv.VariantTrack.prototype.getFileHeader = function () {
        var self = this;

        return new Promise(function (fulfill, reject) {
            if (typeof self.featureSource.getFileHeader === "function") {
                self.featureSource.getFileHeader().then(function (header) {
                    if (header) {
                        // Header (from track line).  Set properties,unless set in the config (config takes precedence)
                        if (header.name && !self.config.name) {
                            self.name = header.name;
                        }
                        if (header.color && !self.config.color) {
                            self.color = "rgb(" + header.color + ")";
                        }
                        self.callSets = header.callSets;

                        if ('compute' === self.visibilityWindow) {
                            computeVisibilityWindow.call(self);
                        }
                    }
                    fulfill(header);

                }).catch(reject);
            }
            else {
                fulfill(null);
            }
        });
    }


    function computeVisibilityWindow() {

        if (this.callSets) {
            if (this.callSets.length < 10) {
                this.visibilityWindow = DEFAULT_VISIBILITY_WINDOW;
            }
            else {
                this.visibilityWindow = 1000 + ((2500 / this.callSets.length) * 40);
            }
        }
        else {
            this.visibilityWindow = DEFAULT_VISIBILITY_WINDOW;
        }

        this.featureSource.visibilityWindow = this.visibilityWindow;


    }

    igv.VariantTrack.prototype.getFeatures = function (chr, bpStart, bpEnd) {

        var self = this;

        return new Promise(function (fulfill, reject) {

            self.featureSource.getFeatures(chr, bpStart, bpEnd).then(function (features) {
                fulfill(features);
            }).catch(reject);

        });
    }



    /**
     * The required height in pixels required for the track content.   This is not the visible track height, which
     * can be smaller (with a scrollbar) or larger.
     *
     * @param features
     * @returns {*}
     */
    igv.VariantTrack.prototype.computePixelHeight = function (features) {

        var callSets = this.callSets,
            nCalls = callSets ? callSets.length : 0,
            vGap = (this.displayMode === 'EXPANDED') ? this.expandedVGap : this.squishedVGap,
            nRows,
            h;

        if (this.displayMode === "COLLAPSED") {
            this.nRows = 1;
            return 10 + this.variantHeight;
        }
        else {
            var maxRow = 0;
            if (features && (typeof features.forEach === "function")) {
                features.forEach(function (feature) {
                    if (feature.row && feature.row > maxRow) maxRow = feature.row;

                });
            }
            nRows = maxRow + 1;

            h = 10 + nRows * (this.variantHeight + vGap);
            this.nRows = nRows;  // Needed in draw function


            // if ((nCalls * nRows * this.expandedCallHeight) > 2000) {
            //     this.expandedCallHeight = Math.max(1, 2000 / (nCalls * nRows));
            // }

            return h + vGap + nCalls * ((this.displayMode === "EXPANDED" ? this.expandedCallHeight : this.squishedCallHeight)+vGap);
            //return h + vGap + nCalls * nRows * (this.displayMode === "EXPANDED" ? this.expandedCallHeight : this.squishedCallHeight);

        }

    };

    igv.VariantTrack.prototype.draw = function (options) {
        var featureList = options.features,
            ctx = options.context,
            bpPerPixel = options.bpPerPixel,
            bpStart = options.bpStart,
            pixelWidth = options.pixelWidth,
            pixelHeight = options.pixelHeight,
            bpEnd = bpStart + pixelWidth * bpPerPixel + 1,
            callHeight = ("EXPANDED" === this.displayMode ? this.expandedCallHeight : this.squishedCallHeight),
            vGap = (this.displayMode === 'EXPANDED') ? this.expandedVGap : this.squishedVGap,
            px, px1, pw, py, h, style, i, variant, call, callSet, j, allRef, allVar, callSets,
            cr, cg, cb, firstAllele, secondAllele, maxLen, minLen, colorScale;

        this.variantBandHeight = 10 + this.nRows * (this.variantHeight + vGap);

        callSets = this.callSets;

        // console.log("feature list: ", featureList);
        //
        // console.log("callsets: ", callSets);

        igv.graphics.fillRect(ctx, 0, 0, pixelWidth, pixelHeight, {'fillStyle': "rgb(255, 255, 255)"});

        if (callSets && callSets.length > 0 && "COLLAPSED" !== this.displayMode) {
            igv.graphics.strokeLine(ctx, 0, this.variantBandHeight, pixelWidth, this.variantBandHeight, {strokeStyle: 'rgb(224,224,224) '});
        }

        if (featureList) {
            for (i = 0, len = featureList.length; i < len; i++) {
                variant = featureList[i];
                if (variant.end < bpStart) continue;
                if (variant.start > bpEnd) break;

                py = 10 + ("COLLAPSED" === this.displayMode ? 0 : variant.row * (this.variantHeight + vGap));
                h = this.variantHeight;

                px = Math.round((variant.start - bpStart) / bpPerPixel);
                px1 = Math.round((variant.end - bpStart) / bpPerPixel);
                pw = Math.max(1, px1 - px);
                if (pw < 3) {
                    pw = 3;
                    px -= 1;
                } else if (pw > 5) {
                    px += 1;
                    pw -= 2;
                }

                ctx.fillStyle = this.color;
                ctx.fillRect(px, py, pw, h);


                if (callSets && variant.calls && "COLLAPSED" !== this.displayMode) {
                    h = callHeight;

                    for (j = 0; j < callSets.length; j++) {
                        callSet = callSets[j];
                        call = variant.calls[callSet.id];
                        if (call) {

                            // Determine genotype
                            /*allVar = allRef = true;  // until proven otherwise
                            call.genotype.forEach(function (g) {
                                if (g != 0) allRef = false;
                                if (g == 0) allVar = false;
                            });

                            if (allRef) {
                                ctx.fillStyle = this.homrefColor;
                            } else if (allVar) {
                                ctx.fillStyle = this.homvarColor;
                            } else {
                                ctx.fillStyle = this.hetvarColor;
                            }*/



                            // get max and min string lengths
                            maxLen = variant.referenceBases.length;
                            minLen = variant.referenceBases.length;
                            variant.alleles.forEach(function(alleleObj) {
                                var len = alleleObj.allele.length;
                                if (len < minLen) minLen = len;
                                if (len > maxLen) maxLen = len;
                            });

                            colorScale = new igv.GradientColorScale(
                                {
                                    low: minLen,
                                    lowR: 135,
                                    lowG: 206,
                                    lowB: 250,
                                    high: maxLen,
                                    highR: 255,
                                    highG: 69,
                                    highB: 0
                                }
                            );

                            py = this.variantBandHeight + vGap + (j + variant.row) * (h + vGap);
                            //console.log(py);
                            if (!isNaN(call.genotype[0])) {
                                firstAllele = getAlleleString(call, variant, 0);
                                secondAllele = getAlleleString(call, variant, 1);

                                // gradient color scheme based on allele length
                                ctx.fillStyle = colorScale.getColor(firstAllele.length);
                                ctx.fillRect(px, py, pw, h/2);
                                ctx.fillStyle = colorScale.getColor(secondAllele.length);
                                ctx.fillRect(px, py+h/2, pw, h/2);
                                if (this.displayMode === 'EXPANDED') {
                                    ctx.beginPath();
                                    ctx.moveTo(px, py+h/2);
                                    ctx.lineTo(px+pw, py+h/2);
                                    ctx.strokeStyle = '#000';
                                    ctx.stroke();
                                }

                            } else {
                                // console.log("no call made, set fill to white");
                                //ctx.fillStyle = "#FFFFFF";
                                ctx.strokeStyle = "#B0B0B0";
                                //ctx.lineWidth = 0.8;
                                ctx.strokeRect(px, py, pw, h);
                            }
                        }
                    }
                }
            }
        }
        else {
            console.log("No feature list");
        }

    };

    function getAlleleString(call, variant, alleleNum) {
        if (alleleNum <= 0) alleleNum = 0;
        else alleleNum = 1;
        return (call.genotype[alleleNum] > 0) ? variant.alleles[call.genotype[alleleNum]-1].allele : variant.referenceBases;
    }

    igv.VariantTrack.prototype.sortCallsets = function(variant) {
        this.callSets.sort(function(a, b) {
            var callA = variant.calls[a.id];
            var callB = variant.calls[b.id];
            var aMax = Math.max(getAlleleString(callA, variant, 0).length, getAlleleString(callA, variant, 1).length);
            var bMax = Math.max(getAlleleString(callB, variant, 0).length, getAlleleString(callB, variant, 1).length);
            return bMax - aMax;
        });
    };

    igv.VariantTrack.prototype.altClick = function(genomicLocation, referenceFrame, event) {
        var chr = referenceFrame.chrName,
            tolerance = Math.floor(2 * referenceFrame.bpPerPixel),  // We need some tolerance around genomicLocation, start with +/- 2 pixels
            featureList = this.featureSource.featureCache.queryFeatures(chr, genomicLocation - tolerance, genomicLocation + tolerance),
            self = this;

        if (this.callSets && featureList && featureList.length > 0) {

            featureList.forEach(function (variant) {

                if ((variant.start <= genomicLocation + tolerance) &&
                    (variant.end > genomicLocation - tolerance)) {
                    self.sortCallsets(variant);
                    self.trackView.update();
                }
            });
        }
    };

    igv.VariantTrack.prototype.popupDataWithConfiguration = function (config) {
        return this.popupData(config.genomicLocation, config.x, config.y, config.viewport.genomicState.referenceFrame)
    };

    /**
     * Return "popup data" for feature @ genomic location.  Data is an array of key-value pairs
     */
    igv.VariantTrack.prototype.popupData = function (genomicLocation, xOffset, yOffset, referenceFrame) {

        // We use the featureCache property rather than method to avoid async load.  If the
        // feature is not already loaded this won't work,  but the user wouldn't be mousing over it either.
        if (this.featureSource.featureCache) {

            var chr = referenceFrame.chrName,
                tolerance = Math.floor(2 * referenceFrame.bpPerPixel),  // We need some tolerance around genomicLocation, start with +/- 2 pixels
                featureList = this.featureSource.featureCache.queryFeatures(chr, genomicLocation - tolerance, genomicLocation + tolerance),
                vGap = (this.displayMode === 'EXPANDED') ? this.expandedVGap : this.squishedVGap,
                popupData = [],
                self = this;

            if (featureList && featureList.length > 0) {

                featureList.forEach(function (variant) {

                    var row, callHeight, callSets, cs, call;

                    if ((variant.start <= genomicLocation + tolerance) &&
                        (variant.end > genomicLocation - tolerance)) {

                        if (popupData.length > 0) {
                            popupData.push('<HR>')
                        }

                        if ("COLLAPSED" == self.displayMode) {
                            Array.prototype.push.apply(popupData, variant.popupData(genomicLocation));
                        }
                        else {
                            if (yOffset <= self.variantBandHeight) {
                                // Variant
                                row = (Math.floor)((yOffset - 10 ) / (self.variantHeight + vGap));
                                if (variant.row === row) {
                                    console.log('variant.popupData called');
                                    Array.prototype.push.apply(popupData, variant.popupData(genomicLocation));
                                }
                            }
                            else {
                                // Call
                                callSets = self.callSets;
                                if (callSets && variant.calls) {
                                    callHeight = self.nRows * ("SQUISHED" === self.displayMode ? self.squishedCallHeight : self.expandedCallHeight);
                                    // console.log("call height: ", callHeight);
                                    // console.log("nRows: ", self.nRows);
                                    row = Math.floor((yOffset - self.variantBandHeight - vGap) / (callHeight+vGap));
                                    cs = callSets[row];
                                    call = variant.calls[cs.id];
                                    Array.prototype.push.apply(popupData, extractPopupData(call, variant));
                                }
                            }
                        }
                    }
                });
            }
            return popupData;
        }
    }

    /**
     * Default popup text function -- just extracts string and number properties in random order.
     * @param call
     * @param variant
     * @returns {Array}
     */
    function extractPopupData(call, variant) {

        var gt = '', popupData, i, allele, numRepeats = '', alleleFrac='';
        var info = variant.getInfoObj(variant.info);
        if (!isNaN(call.genotype[0])) {
            for (i = 0; i < call.genotype.length; i++) {
                if (call.genotype[i] === 0) {
                    allele = variant.referenceBases;
                    gt += allele;
                    numRepeats += (allele.length / info.PERIOD).toString();
                    alleleFrac += (parseInt(info.REFAC) / parseInt(info.AN)).toFixed(3);
                } else {
                    allele = variant.alleles[call.genotype[i] - 1].allele;
                    gt += allele;
                    numRepeats += (allele.length / info.PERIOD).toString();
                    alleleFrac += (parseInt(info.AC.split(',')[call.genotype[i] - 1]) / parseInt(info.AN)).toFixed(3);
                }
                if (i < call.genotype.length - 1) {
                    gt += " | ";
                    numRepeats += " | ";
                    alleleFrac += " | ";
                }
            }
        }
        // call.genotype.forEach(function (i) {
        //     if (i === 0) {
        //         gt += variant.referenceBases;
        //     }
        //     else {
        //         gt += variant.alternateBases[i - 1];
        //     }
        // });

        popupData = [];

        if (call.callSetName !== undefined) {
            popupData.push({name: 'Name', value: call.callSetName});
        }
        popupData.push({name: 'Genotype', value: gt});
        if (numRepeats) {
            popupData.push({name: 'Repeats', value: numRepeats});
        }
        if (alleleFrac) {
            popupData.push({name: 'Allele Fraction', value: alleleFrac});
        }
        if (call.phaseset !== undefined) {
            popupData.push({name: 'Phase set', value: call.phaseset});
        }
        if (call.genotypeLikelihood !== undefined) {
            popupData.push({name: 'genotypeLikelihood', value: call.genotypeLikelihood.toString()});
        }
        if (popupData.length > 2) {
            popupData.push("<hr>");
        }


        Object.keys(call.info).forEach(function (key) {
            popupData.push({name: key, value: call.info[key]});
        });

        return popupData;
    }

    igv.VariantTrack.prototype.menuItemList = function (popover) {

        var self = this,
            menuItems = [],
            mapped, $color, colorClickHandler;

        menuItems.push(igv.colorPickerMenuItem(popover, this.trackView));

        mapped = _.map(["COLLAPSED", "SQUISHED", "EXPANDED"], function(displayMode, index) {
            return {
                object: $(markupStringified(displayMode, index, self.displayMode)),
                click: function () {
                    popover.hide();
                    self.displayMode = displayMode;
                    self.trackView.update();
                }
            };
        });

        menuItems = menuItems.concat(mapped);

        function markupStringified(displayMode, index, selfDisplayMode) {

            var lut,
                chosen;

            lut =
            {
                "COLLAPSED": "Collapse",
                "SQUISHED": "Squish",
                "EXPANDED": "Expand"
            };

            chosen = (0 === index) ? '<div class="igv-track-menu-border-top">' : '<div>';
            if (displayMode === selfDisplayMode) {
                return chosen + '<i class="fa fa-check fa-check-shim"></i>' + lut[ displayMode ] + '</div>'
            } else {
                return chosen + '<i class="fa fa-check fa-check-shim fa-check-hidden"></i>' + lut[ displayMode ] + '</div>';
            }

        }

        // $color = $('<div>');
        // $color.text("Color Scheme");
        // colorClickHandler = function() {
        //     popover.hide();
        //     self.colorScheme = (self.colorScheme === "GRADIENT") ? "INDEX" : "GRADIENT";
        //     self.trackView.update();
        // };
        //
        // menuItems.push({object: $color, click: colorClickHandler});

        return menuItems;

    };

    //      igv.VariantTrack.prototype.menuItemList = function (popover) {
    //
    //     var myself = this,
    //         menuItems = [],
    //         lut = {"COLLAPSED": "Collapse", "SQUISHED": "Squish", "EXPANDED": "Expand"},
    //         checkMark = '<i class="fa fa-check fa-check-shim"></i>',
    //         checkMarkNone = '<i class="fa fa-check fa-check-shim fa-check-hidden"></i>',
    //         trackMenuItem = '<div class=\"igv-track-menu-item\">',
    //         trackMenuItemFirst = '<div class=\"igv-track-menu-item igv-track-menu-border-top\">';
    //
    //     menuItems.push(igv.colorPickerMenuItem(popover, this.trackView));
    //
    //     ["COLLAPSED", "SQUISHED", "EXPANDED"].forEach(function (displayMode, index) {
    //
    //         var chosen,
    //             str;
    //
    //         chosen = (0 === index) ? trackMenuItemFirst : trackMenuItem;
    //         str = (displayMode === myself.displayMode) ? chosen + checkMark + lut[displayMode] + '</div>' : chosen + checkMarkNone + lut[displayMode] + '</div>';
    //
    //         menuItems.push({
    //             object: $(str),
    //             click: function () {
    //                 popover.hide();
    //                 myself.displayMode = displayMode;
    //                 myself.trackView.update();
    //             }
    //         });
    //
    //     });
    //
    //     return menuItems;
    //
    // };


    return igv;

})
(igv || {});
