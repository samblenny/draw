// Copyright (c) 2022 Sam Blenny
// SPDX-License-Identifier: MIT
//
// A vector drawing language interpreter inspired by Forth and Logo
//
function drawInterpreter(svgID, initialX, initialY) {
    var compileMode, compileName, compileWords, compileOkay;
    var onStack, stackTop, stackSecond, stackPointer, ringBuffer, ringBufferSize;
    var x, y, h, penDown;
    var newSubpath, traceOn, paths, currentPath;
    var svgElement, svgPath;
    var logLimit;

    svgElement = document.getElementById(svgID);
    // The namespace matters! A plain createElement() won't work right.
    svgPath = document.createElementNS("http://www.w3.org/2000/svg","path");
    svgElement.appendChild(svgPath);

    // Interpreter state
    // =====================================================================
    function resetInterpreter() {
        compileMode = false;
        compileName = "";
        compileWords = [];
        compileOkay = false;
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
        x = initialX ? initialX : 0;
        y = initialY ? initialY : 0;
        h = 270;
        penDown = true;
        newSubpath = true;
        traceOn = false;
        paths = [];
        currentPath = [];
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
            var dy = stackTop*Math.sin(Math.PI/180*h);
            line(x,y,x+dx,y+dy);
            x = x+dx;
            y = y+dy;
            dPop();
        },
        "B": function() {
            var dx = stackTop*Math.cos(Math.PI/180*(h+180));
            var dy = stackTop*Math.sin(Math.PI/180*(h+180));
            line(x,y,x+dx,y+dy);
            x = x+dx;
            y = y+dy;
            dPop();
        },
        "L": function() {
            h = (360+((h-stackTop)%360))%360;
            dPop();
        },
        "R": function() {
            h = (h+stackTop)%360;
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
            arc(-angle,radius);
        },
        "ArcR": function() {
            var angle = stackTop;
            var radius = stackSecond;
            dPop();
            dPop();
            arc(angle,radius);
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
        "SetH": function() {
            h = stackTop;
            dPop();
        },
        "SetX": function() {
            x = stackTop;
            dPop();
        },
        "SetY": function() {
            y = stackTop;
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
    function preparePath() {
        var d, pathX, pathY, i, j;
        // Compute the path, including subpaths
        d = "";
        pathX = 0;
        pathY = 0;
        for(i=0; i<paths.length; i++) {
            for(j=0; j+1<paths[i].length; j+=2) {
                pathX = paths[i][j];
                pathY = paths[i][j+1];
                if(j==0) {
                    d += "M"+pathX.toFixed(1)+" "+pathY.toFixed(1)+"\n";
                } else {
                    d += "L"+pathX.toFixed(1)+" "+pathY.toFixed(1)+"\n";
                }
            }
        }
        svgPath.setAttribute("d",d);
        paths = [];
        currentPath = [];
    }

    function line(x1,y1,x2,y2) {
        // This is the inner loop workhorse for adding line segments
        if(penDown) {
            if(newSubpath) {
                currentPath = [x1, y1];
                paths.push(currentPath);
                newSubpath = false;
            }
            currentPath.push(x2);
            currentPath.push(y2);
        }
    }

    function makeLine(r) {
        var dx = r*Math.cos(Math.PI/180*h);
        var dy = r*Math.sin(Math.PI/180*h);
        line(x,y,x+dx,y+dy);
        x += dx;
        y += dy;
    }

    function dot(radius) {
        // TODO: implement this
    }

    function arc(angle,radius) {
        // Approximate a circular arc with multiple short line segments
        var i;
        var fraction = angle%3.0;
        var halfChord = Math.sin(Math.PI/360*fraction)*radius;
        if(Math.abs(fraction)>0) {
            makeLine(halfChord);
            h += fraction;
            makeLine(halfChord);
        }
        angle = Math.round(angle-fraction);
        halfChord = Math.sin(Math.PI/360*3)*radius;
        if(angle>0) {
            for(i=0; i<angle/3; i++) {
                makeLine(halfChord);
                h += 3;
                makeLine(halfChord);
            }
        } else if(angle<0) {
            for(i=0; angle/3<i; i--) {
                makeLine(halfChord);
                h -= 3;
                makeLine(halfChord);
            }
        }
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
            lines = inputString.split(/\r|\n/);
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
