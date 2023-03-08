/* Copyright (c) 2022 Sam Blenny */
/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */
/*
 * A vector drawing language interpreter inspired by Forth and Logo
 */
"use strict";


/********************************/
/* Constants & Global Variables */
/********************************/

/* Editor box code selection dropdown */
const EDIT_SELECT = document.querySelector("#edit-select");

/* HTML textarea element that serves as a text editor */
const EDITOR = document.querySelector("#editor");

/* SVG canvas-size selection dropdown */
const CANVAS_SIZE_SELECT = document.querySelector("#canvas-size");

/* SVG grid size selection dropdown */
const CANVAS_GRID_SELECT = document.querySelector("#canvas-grid");

/* HTML SVG element that serves as a canvas */
const CANVAS_SVG = document.querySelector("#gridD svg");

/* Button to download SVG (actually an <a>, but style is like button) */
const DOWNLOAD_TXT = document.querySelector("#download-txt");

/* Button to download SVG (actually an <a>, but style is like button) */
const DOWNLOAD_SVG = document.querySelector("#download-svg");

/* Source code for "Lots of Dots" example */
const SRC_LotsOfDots = `
# Lots of Dots

: u 5 * ;
: 2E 2 u E ;
: 4E 4 u E ;
: 4N 4 u N ;
: rstX -206 X= ;
: rstY -40 Y= ;
: rstH 0 H= ;

: dot 1 u 360 ArcL ;    # dot
: a dot 4E 30 L ;       # dot + gap
: b a a a a a ;         # 5 dots
: c b 2E b 2E b 2E b ;  # 15 dots
: d rstX 4N rstH ;      # move NW
: e c d ;               # 1 row
: f e e e e e ;         # 5 rows

rstX rstY rstH
f
`.trim();

/* Source code for "Arcs Test" example */
const SRC_ArcsTest = `
# Arcs Test (try size=128x128)
: u 7 * ;
: a PU 0 dup Y= over + X= PD ;
: b a 90 H= swap ArcL ;
: c PU 0 dup Y= over + X= PD ;
: d c 270 H= swap ArcR ;
: e over over b 0.5 u + d ;
45 8 u e
90 2 u e
135 6 u e
180 4 u e
225 5 u e
270 3 u e
315 7 u e
360 1 u e`.trim();

/* Source code for "Fibonacci" example */
const SRC_Fibonacci = `
# Fibonacci Spiral
: a dup F 90 R ;
: b 2.1 * a a a a 90 ArcR ;
108 X= 65 Y= 90 H=
1 b
1 b
2 b
3 b
5 b
8 b
13 b
21 b
34 b
55 b
89 b
144 b
`.trim();

/* Source code for "Sierpinski" example */
const SRC_Sierpinski = `
# Sierpinski Arrowhead
: l 60 L ;
: r 60 R ;
: a r dup F l dup F l dup F r ;
: b l dup F r dup F r dup F l ;
: c r b l a l b r ;
: d l a r b r a l ;
: e r d l c l d r ;
: g l c r d r c l ;
: h g l e l g ;
: i e r g r e ;
: j i l h l i ;
: k h r i r h ;
: m k l j l k ;
: n j r k r j ;
: o n l m l n ;
: p m r n r m ;
: q p l o l p ;
: s o r p r o ;

-251 X= -212 Y= 0 H=
0.98 q r s r q
`.trim();

/* Previously selected editor box choice */
var PREV_SELECTED = EDIT_SELECT.value || "";

/* Scratch buffer text */
var SCRATCH_BUF = "";

/* Size of SVG canvas (side of square in pixels) */
var CANVAS_SIZE = 512;

/* Size of grid in pixels */
var CANVAS_GRID_SIZE = 64;

/* Zoom factor for SVG canvas */
var CANVAS_ZOOM = 1;


/*****************************************/
/* Data Structures for Colors and Shapes */
/*****************************************/


// Color Theme with light and dark modes
class Theme {

    // Test if browser reports that host OS is set to dark mode
    static dark() {
        const s = '(prefers-color-scheme: dark)';
        return window.matchMedia && window.matchMedia(s).matches;
    }

    // Getters to be used as: Theme.bg, Theme.fg, Theme.accent
    static get bg()     { return Theme.dark() ? "#1e1e23" : "#ffffff"; }
    static get fg()     { return Theme.dark() ? "#eeeeee" : "#000000"; }
    static get accent() { return Theme.dark() ? "#323232" : "#e7e7e7"; }
}


// SVG Path with configurable stroke and fill colors
class Path {

    // Default path attributes
    static defaults = {
        "stroke-width": "1px",
        "fill": "none",
    }

    // Format a number to balance precision with compactness for an SVG path
    static formatNum(n) {
        const regexTrimTrailingZeros = /\.?0*$/;
        return n.toFixed(3).replace(regexTrimTrailingZeros, '');
    }

    constructor(attributes) {
        // Dictionary to override default stroke, stroke-width, fill, etc.
        this.attributes = attributes || {};
        // List path commands for d attribute
        this.dCommands = [''];
    }

    // Append an "M..." (move) path command
    moveTo(x, y) {
        // Scale coordinate to svg n.1 fixed point (e.g. 3.1 becomes 31)
        // This makes svg code smaller by omitting lots and lots of '.'
        // characters
        const xScaled = Path.formatNum(x);
        const yScaled = Path.formatNum(y);
        this.dCommands.push(`M${xScaled},${yScaled}`);
    }

    // Append an "L..." (line) path command
    lineTo(x, y) {
        const xScaled = Path.formatNum(x);
        const yScaled = Path.formatNum(y);
        this.dCommands.push(`L${xScaled},${yScaled}`);
    }

    // Append an "A..." (arc) path command
    arcTo(radius, largeArc, sweep, x, y) {
        const r = Path.formatNum(radius);
        const xScaled = Path.formatNum(x);
        const yScaled = Path.formatNum(y);
        const cmd = `A${r} ${r} 0 ${largeArc} ${sweep} ${xScaled},${yScaled}`;
        this.dCommands.push(cmd);
    }

    // Get an SVG path attribute for this path
    getAttr(key) {
        const dflt = Path.defaults[key] || "";
        const attr = this.attributes[key];
        return attr ? attr : dflt;
    }

    // Set attributes of SVG element <path> to this path's current state
    updatePathElement(path) {
        this.dCommands.push('');  // End with a newline
        path.setAttribute("d", this.dCommands.join("\n"));
        // Handle stroke attribute specially to pick up light/dark mode changes
        const stroke = this.attributes["stroke"] || Theme.fg;
        path.setAttribute("stroke", stroke);
        // First set default attribute values, then set custom attribute values
        // for this path, potentially replacing default values.
        for(const k of Object.keys(Path.defaults)) {
            path.setAttribute(k, Path.defaults[k]);
        }
        for(const k of Object.keys(this.attributes)) {
            path.setAttribute(k, this.attributes[k]);
        }
    }
}


/*************************************/
/* Utility Functions and Interpreter */
/*************************************/

function drawInterpreter(svgID) {
    var compileMode, compileName, compileWords, compileOkay;
    var onStack, stackTop, stackSecond, stackPointer, ringBuffer, ringBufferSize;
    var x, y, h, penDown;
    var newSubpath, traceOn, gridPath, strokedPath;
    var svgElement, GRID, LINES;
    var logLimit;
    var userDict;

    svgElement = CANVAS_SVG;
    // The namespace matters! A plain createElement() won't work right.
    GRID = document.createElementNS("http://www.w3.org/2000/svg","path");
    svgElement.appendChild(GRID);
    LINES = document.createElementNS("http://www.w3.org/2000/svg","path");
    svgElement.appendChild(LINES);

    // Interpreter state
    // =====================================================================
    function resetInterpreter() {
        compileMode = false;
        compileName = "";
        compileWords = [];
        compileOkay = false;
        userDict = {};
    }

    // Circular data stack
    // =====================================================================
    function resetStack() {
        onStack = 0;
        stackTop = 0;
        stackSecond = 0;
        stackPointer = 0;
        // This buffer is for the stuff below stackTop and stackSecond, so
        // the total capacity of the stack is ringBuffer.length + 2
        ringBuffer = [0,0,0,0,0,0,0,0,0,0,0,0,0,0];
        ringBufferSize = ringBuffer.length;
    }

    function dPush(n) {
        onStack += 1;
        if(onStack>ringBufferSize+2) {
            // Instead of throwing a stack overflow exception, this just
            // wraps around the ring buffer ad overwrites the lowest item
            // on the stack.
            onStack = ringBufferSize+2;
        }
        stackPointer = (stackPointer+1)%ringBufferSize;
        ringBuffer[stackPointer] = stackSecond;
        stackSecond = stackTop;
        stackTop = n;
    }

    function dPop() {
        // Allow this to go negative so we can use the debug logging to
        // watch for underflow problems
        onStack -= 1;
        stackTop = stackSecond;
        stackSecond = ringBuffer[stackPointer];
        stackPointer = (ringBufferSize+stackPointer-1)%ringBufferSize;
    }


    // Turtle & canvas state
    // =====================================================================
    function resetTurtleAndCanvas() {
        x = 0;
        y = 0;
        h = 90;
        penDown = true;
        newSubpath = true;
        traceOn = false;
        gridPath = new Path({
            "stroke": Theme.accent,
            "shape-rendering": "crispEdges",
            "stroke-linecap": "square",
        });
        strokedPath = new Path({
            "stroke-linejoin": "round",
            "stroke-linecap": "round",
        });
    }


    // Dictionaries
    // =====================================================================
    var builtinDict = {
        ":": function() {
            compileMode=true;
            compileName="";
            compileWords=[];
            compileOkay=true;
        },
        ";": function() {
            compileMode=false;
            if(compileOkay){
                userDict[compileName]=compileWords;
            }
        },
        "+": function() {
            var n = stackSecond+stackTop;
            dPop();
            stackTop=n;
        },
        "-": function() {
            var n = stackSecond-stackTop;
            dPop();
            stackTop=n;
        },
        "*": function() {
            var n = stackSecond*stackTop;
            dPop();
            stackTop=n;
        },
        "dup": function() {
            dPush(stackTop);
        },
        "drop": function() {
            dPop();
        },
        "swap": function() {
            var n = stackTop;
            stackTop = stackSecond;
            stackSecond = n;
        },
        "over": function() {
            dPush(stackSecond);
        },
        "F": function() {
            var dx = stackTop*Math.cos(Math.PI/180*h);
            var dy = -1 * stackTop*Math.sin(Math.PI/180*h);
            line(x,y,x+dx,y+dy);
            x = x+dx;
            y = y+dy;
            dPop();
        },
        "B": function() {
            var dx = stackTop*Math.cos(Math.PI/180*(h+180));
            var dy = -1 * stackTop*Math.sin(Math.PI/180*(h+180));
            line(x,y,x+dx,y+dy);
            x = x+dx;
            y = y+dy;
            dPop();
        },
        "L": function() {
            h = (h + stackTop) % 360;
            dPop();
        },
        "R": function() {
            h = (360 + h - stackTop) % 360;
            dPop();
        },
        "N": function() {
            newSubpath = true;
            y -= stackTop;
            dPop();
        },
        "S": function() {
            newSubpath = true;
            y += stackTop;
            dPop();
        },
        "E": function() {
            newSubpath = true;
            x += stackTop;
            dPop();
        },
        "W": function() {
            newSubpath = true;
            x -= stackTop;
            dPop();
        },
        "ArcL": function() {
            var angle = stackTop;
            var radius = stackSecond;
            dPop();
            dPop();
            arc(angle,radius);
        },
        "ArcR": function() {
            var angle = stackTop;
            var radius = stackSecond;
            dPop();
            dPop();
            arc(-angle,radius);
        },
        "Dot": function() {
            var radius = stackTop;
            dPop();
            dot(radius);
        },
        "PD": function() {
            penDown = true;
            newSubpath = true;
        },
        "PU": function() {
            penDown = false;
        },
        "H=": function() {
            h = stackTop;
            dPop();
        },
        "X=": function() {
            x = stackTop;
            dPop();
        },
        "Y=": function() {
            y = -stackTop;
            dPop();
        },
        "TRON": function() {
            traceOn = true;
        },
        "TROFF": function() {
            traceOn = false;
        },
        "NOP": function() {
            /* sometimes useful for stack tracing */
        },
    };

    function resetUserDict() {
        userDict={};
    }


    // Draw lines
    // =====================================================================

    // Make a grid path
    function drawGrid(pxSize) {
        // Skip grid if size is 0 (this happens for grid: "none" selection)
        if(CANVAS_GRID_SIZE < 1) {
            return;
        }
        const minx = -(CANVAS_SIZE / 2);
        const miny = minx;
        const width = CANVAS_SIZE;
        const height = width;
        // Adjust stroke witdh inversely proportional to zoom
        const strokeWidth = `${(1 / CANVAS_ZOOM).toFixed(5)}px`;
        gridPath.attributes["stroke-width"] = strokeWidth;
        // Vertical grid lines
        for(let x = minx; x <= minx + width; x += CANVAS_GRID_SIZE) {
            gridPath.moveTo(x, miny);
            gridPath.lineTo(x, miny + height);
        }
        // Horizontal grid lines
        for(let y = miny; y <= miny + width; y += CANVAS_GRID_SIZE) {
            gridPath.moveTo(minx, y);
            gridPath.lineTo(minx + width, y);
        }
    }

    // Update all the svg elements
    function preparePath() {
        drawGrid();
        gridPath.updatePathElement(GRID);
        strokedPath.updatePathElement(LINES);
        CANVAS_SVG.style.background = Theme.bg;
    }

    function line(x1,y1,x2,y2) {
        // This is the inner loop workhorse for adding line segments
        if(penDown) {
            if(newSubpath) {
                strokedPath.moveTo(x1, y1);
                newSubpath = false;
            }
            strokedPath.lineTo(x2, y2);
        }
    }

    function dot(radius) {
        // TODO: implement this
    }

    // Draw a circular arc segment (SVG path d="... A ...")
    function arc(angle, radius) {
        if(angle == 0) {
            return;
        }
        const left = (angle > 0);
        if(angle % 360 == 0) {
            // SVG path element seemst to not like arcs of exactly 360 degrees,
            // so split those into two 180 degree arcs.
            const a = left ? 180 : -180;
            arc(a, radius);
            arc(a, radius);
            return;
        }
        // Calculate bearing from pen (turtle) to to center of circular arc
        const centerBearing = left ? (h + 90) % 360 : (h + 270) % 360;
        // Calculate center point of circular arc
        const dToR = Math.PI / 180;
        const centerX = x + (radius * Math.cos(dToR * centerBearing));
        const centerY = y - (radius * Math.sin(dToR * centerBearing));
        // Calculate bearing from center point to end point of circular arc
        const endBearing = (180 + centerBearing + angle) % 360;
        // Calculate end point of circular arc
        const endX = centerX + (radius * Math.cos(dToR * endBearing));
        const endY = centerY - (radius * Math.sin(dToR * endBearing));
        // Generate the SVG path segment
        if(penDown) {
            if(newSubpath) {
                strokedPath.moveTo(x, y);
                newSubpath = false;
            }
            let largeArc = (Math.abs(angle) > 180) ? "1" : "0";
            let sweep = left ? "0" : "1";
            strokedPath.arcTo(radius, largeArc, sweep, endX, endY);
        }
        x = endX;
        y = endY;
        h += angle;
    };


    // Debug output
    // =====================================================================
    function wrap(slot) {
        return (ringBufferSize+stackPointer-slot)%ringBufferSize;
    }

    function showAll(prefix) {
        prefix = (prefix===undefined)?"":prefix;
        var text = prefix;
        if(onStack<0) {
            text = text+"stack is "+Math.abs(onStack)+" under";
        } else {
            if(onStack==0) {
                text = text+"empty stack";
            }
            if(onStack>2) {
                for(var i=0; i<onStack-2; i++) {
                    text = text+ringBuffer[wrap(onStack-3-i)].toFixed(1)+" ";
                }
            }
            if(onStack>1) {
                text = text+stackSecond.toFixed(1)+" ";
            }
            if(onStack>0) {
                text = text+stackTop.toFixed(1);
            }
        }
        log(text);
    };

    function pad7(n) {
        var p="";
        n=n.toFixed(1);
        for(var i=0;i<7-n.length;i++) {
            p+=" ";
        }
        return p+n;
    }

    function trace(word,callDepth) {
        var indent = "";
        var pad = "";
        var i
        for(i=0; i<callDepth; i++) {
            indent = indent+"   ";
        }
        for(i=0; callDepth*3+word.length+i<=30; i++) {
            pad = pad+".";
        }
        var s= indent+word+" "+pad;
        s+=" ("+pad7(x)+","+pad7(y)+","+pad7(h)+")";
        s+="  ";
        showAll(s);
    }

    // During interactive editing, simple errors in a complex draw program
    // can potentially generate thousands of log messages in a very short time.
    // Dumping all of that to the console log could make the browser's UI thread
    // unresponsive, so we cap how many log messages can get sent to the console.
    function resetLogLimit() {
        logLimit=500;
        return "ready";
    }

    function log(text) {
        if(logLimit>0) {
            console.log(text);
            logLimit-=1;
        } else if(logLimit==0) {
            console.log("Too many log entries. Logging suspended.");
            console.log("Try 'resetLogLimit()' from the console.");
            logLimit-=1;
        }
    }


    // Execute a word. In interpret mode, put numbers on the stack and call
    // words that are defined in the dictionaries. In compile mode, numbers
    // and most words go into the user dictionary, but ";" is called
    // immediately. It's possible to intentionally craft a sequence of word
    // definitions which create an infinite recursive loop. Preventing such
    // definitions would interfere with other useful capabilities, so
    // instead there is a check for maximum call depth which will interrupt
    // infinite recursion. This function assumes that an earlier stage of
    // the parsing has already filtered out comments and white space.
    // =====================================================================
    function executeWord(w,callDepth) {
        var maxDepth=30;
        callDepth=(callDepth===undefined)?0:callDepth;
        if(compileMode) {
            if(w==";") {
                builtinDict[w]();
            } else if(compileName=="") {
                compileName=w;
                if(traceOn){
                    trace(": "+w,0);
                }
            } else if(w==":"){
                log(":?");
                compileOkay=false;
            } else if(builtinDict[w]!==undefined) {
                compileWords.push(w);
            } else if(userDict[w]!==undefined) {
                compileWords.push(w);
            } else if(!isNaN(w)) {
                compileWords.push(w);
            } else{
                log(w+"?");
                compileOkay=false;
            }
        } else {
            if(callDepth>=maxDepth) {
                log("call stack too deep: "+w);
            } else if(w==":") {
                builtinDict[w]();
            } else {
                if(traceOn) {
                    trace(w,callDepth);
                }
                if(builtinDict[w]!==undefined) {
                    builtinDict[w]();
                } else if(userDict[w]!==undefined) {
                    var dict = userDict[w];
                    for(var i=0;i<dict.length;i++) {
                        executeWord(dict[i],callDepth+1);
                    }
                } else if(!isNaN(w)) {
                    dPush(parseFloat(w));
                } else {
                    log(w+"?");
                }
            }
        }
    }


    // To avoid slowing down WebKit, initialize the log limit only at load time,
    // allowing the option for people to manually invoke resetLogLimit()
    // from the console if they want to.
    resetLogLimit();

    return {

        // Entry point for the draw "Interpreter".
        //
        // The point of draw is to make it fun and easy for me to draw
        // vector graphics, and I've ignored a variety of conventions which
        // don't support that goal (e.g. REPL). Interpreter gets quotes
        // because this parser is meant to evaluate a whole program at once,
        // but it  does it in a way that feels interactive and gives immediate
        // feedback.
        //
        // The point of this design is that you can set it up with your code
        // and your drawing side by side in a web page, and the drawing can
        // update immediately as you type.
        //
        run: function(inputString) {
            var i, beforeComment, words, j, w;
            // Reset all state except the log limit (see end of file)
            resetInterpreter();
            resetTurtleAndCanvas();
            resetStack();
            resetUserDict();
            // Process the input string in one pass
            let lines = inputString.split(/\r|\n/);
            for(i=0; i<lines.length; i++) {
                // Filter out comments and blank lines
                beforeComment = lines[i].split("#")[0];
                if(beforeComment!="") {
                    words = beforeComment.trim().split(/\t| /);
                    for(j=0; j<words.length; j++) {
                        w = words[j].valueOf();
                        if(w!="") {
                            executeWord(w);
                        }
                    }
                }
            }
            preparePath();
        },

        // This is so the log limit can be manually reset from the console
        "resetLogLimit": resetLogLimit
    };

}

// Further explanation about logging and the log limit...
//
//
// Draw takes a best-effort approach to evaluating all of its input. If it
// encounters a word it doesn't recognize, it will log a warning and attempt to
// continue. It's possible to create a cascade of error messages by partially
// breaking a chain of dependencies. An easy way to do that would be deciding to
// rename a word that was used directly or indirectly by many other words.
// There's nothing wrong with renaming, but it may cause temporarily problems
// with the word definitions in the user dictionary while the edit is in
// progress.


/*************/
/* Init Code */
/*************/

/* Initialize interpreter */
var di = drawInterpreter("canvas_svg");

/* Refresh the dataURL href for the .svg download button */
function updateSvgDownloadButton() {
    let mime = "image/svg+xml";
    let data = `data:${mime},${encodeURIComponent(CANVAS_SVG.outerHTML)}`;
    DOWNLOAD_SVG.setAttribute("href", data);
}

/* Refresh the dataURL href for the .txt download button */
function updateTxtDownloadButton() {
    let mime = "text/plain";
    let data = `data:${mime},${encodeURIComponent(EDITOR.value)}`;
    DOWNLOAD_TXT.setAttribute("href", data);
}

/* Run the current code in the editor box */
function evalCode() {
    di.run(EDITOR.value || "");
    updateTxtDownloadButton();
    updateSvgDownloadButton();
}

/* Set the editor box's text contents */
function setCode(code) {
    EDITOR.value = code;
    evalCode();
}

/* Update editor text to match the dropdown selector */
function updateCodeSelection() {
    let choice = EDIT_SELECT.value || "";
    if(PREV_SELECTED == "") {
        SCRATCH_BUF = EDITOR.value;
    }
    switch(choice) {
    case "LotsOfDots":
        setCode(SRC_LotsOfDots);
        break;
    case "ArcsTest":
        setCode(SRC_ArcsTest);
        break;
    case "Fibonacci":
        setCode(SRC_Fibonacci);
        break;
    case "Sierpinski":
        setCode(SRC_Sierpinski);
        break;
    default:
        setCode(SCRATCH_BUF);
    }
    PREV_SELECTED = choice;
}

function setCanvasSizeAndZoom() {
    const docRoot = document.documentElement;
    const minx = -(CANVAS_SIZE / 2);
    const miny = minx;
    const width = CANVAS_SIZE;
    const height = width;
    const viewBox = `${minx} ${miny} ${width} ${height}`;
    const outer = CANVAS_SIZE * CANVAS_ZOOM;
    docRoot.style.setProperty("--SVG_SIZE", outer);
    CANVAS_SVG.setAttribute("width", outer);
    CANVAS_SVG.setAttribute("height", outer);
    CANVAS_SVG.setAttribute("viewBox", viewBox);
    // Trigger a redraw
    evalCode();
}

/* Update svg size to match the #canvas-size dropdown selector */
function updateCanvasSize() {
    let choice = CANVAS_SIZE_SELECT.value || "";
    switch(choice) {
    case "16":
        CANVAS_SIZE = 16;
        CANVAS_ZOOM = 16;
        break;
    case "32":
        CANVAS_SIZE = 32;
        CANVAS_ZOOM = 16;
        break;
    case "64":
        CANVAS_SIZE = 64;
        CANVAS_ZOOM = 8;
        break;
    case "128":
        CANVAS_SIZE = 128;
        CANVAS_ZOOM = 4;
        break;
    case "256":
        CANVAS_SIZE = 256;
        CANVAS_ZOOM = 2;
        break;
    case "512":
    default:
        CANVAS_SIZE = 512;
        CANVAS_ZOOM = 1;
    }
    setCanvasSizeAndZoom();
}

/* Update grid size to match the #canvas-grid dropdown selector */
function updateGridSize() {
    let choice = CANVAS_GRID_SELECT.value || "";
    switch(choice) {
    case "64":
        CANVAS_GRID_SIZE = 64;
        break;
    case "32":
        CANVAS_GRID_SIZE = 32;
        break;
    case "16":
        CANVAS_GRID_SIZE = 16;
        break;
    case "8":
        CANVAS_GRID_SIZE = 8;
        break;
    case "4":
        CANVAS_GRID_SIZE = 4;
        break;
    case "2":
        CANVAS_GRID_SIZE = 2;
        break;
    case "1":
        CANVAS_GRID_SIZE = 1;
        break;
    default:
        CANVAS_GRID_SIZE = 0;
    }
    // Trigger a redraw
    evalCode();
}

/* Register edit box code select handler */
EDIT_SELECT.addEventListener("change", updateCodeSelection);

/* Register editor box keystroke handler */
EDITOR.addEventListener("input", evalCode);

/* Register canvas size select handler */
CANVAS_SIZE_SELECT.addEventListener("change", updateCanvasSize);

/* Register grid size select handler */
CANVAS_GRID_SELECT.addEventListener("change", updateGridSize);

// Register handler to redraw for OS color scheme (dark mode) settings changes
if(window.matchMedia) {
    const dark = "(prefers-color-scheme: dark)";
    const light = "(prefers-color-scheme: light)";
    window.matchMedia(dark).addListener(evalCode);
    window.matchMedia(light).addListener(evalCode);
}

/* Initialize the editor box with example code (index.html sets selection) */
updateCodeSelection();

/* Set the SVG vewBox */
setCanvasSizeAndZoom();
