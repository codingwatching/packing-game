'use strict';

class InputError extends Error {
    constructor(message) {super(message);}
}

function throwInputError(msg) {
    throw new InputError(msg);
}

var levelGenerators = new Map();
var defaultItemColorTikz = '3399ff';

//==[ Parsing ]=================================================================

function dictAssertAccess(d, key, name) {
    if(d.hasOwnProperty(key)) {
        return d[key];
    }
    else {
        throw new InputError(name + ': missing ' + key);
    }
}

function readObjectPropsWithAssert(input, reqProps, optProps, objname) {
    var o = {};
    for(var prop of reqProps) {
        if(input.hasOwnProperty(prop)) {
            o[prop] = input[prop];
        }
        else {
            throw new InputError("property '" + prop + "' is missing for " + objname);
        }
    }
    if(optProps.constructor === Object) {
        for(let [prop, value] of Object.entries(optProps)) {
            if(input.hasOwnProperty(prop)) {
                o[prop] = input[prop];
            }
            else {
                o[prop] = value;
            }
        }
    }
    return o;
}

function itemInfoFromObject(j, id) {
    if(Array.isArray(j)) {
        if(j.length < 2) {
            throw new InputError('invalid input for item ' + id +
                ': array of length ' + j.length);
        }
        let [xLen, yLen, profit] = j;
        if(profit === undefined) {
            profit = 0;
        }
        return new ItemInfo(id, xLen, yLen, profit, null);
    }
    else {
        var reqProps = ['xLen', 'yLen'];
        var optProps = {'color': null, 'profit': 0};
        var o = readObjectPropsWithAssert(j, reqProps, optProps, 'item ' + id);
        return new ItemInfo(id, o['xLen'], o['yLen'], o['profit'], o['color']);
    }
}

function processLevel(j) {
    var reqProps = ['binXLen', 'binYLen', 'items'];
    var optProps = {'gameType': 'bp', 'startPos': [], 'solution': null,
        'lower_bound': null, 'upper_bound': null, 'solutions': null};
    var o = readObjectPropsWithAssert(j, reqProps, optProps, 'level');
    var items = [];
    if(o.gameType !== 'bp') {
        throw new InputError("the only supported gameType is bp");
    }
    var id = 0;
    for(var itemObj of o['items']) {
        var n = itemObj.n;
        if(n === undefined) {
            n = 1;
        }
        for(var i=0; i<n; ++i) {
            var item = itemInfoFromObject(itemObj, id++);
            items.push(item);
        }
    }
    o.items = items;
    if(o.solutions === null) {
        if(o.solution !== null) {
            o.solutions = {'solution': o.solution};
        }
        else {
            o.solutions = {};
        }
    }
    o.solutions = new Map(Object.entries(o.solutions));

    var ubAlgos = ['ffdh-ff', 'ffdh-ff-mirror'];
    o.computed_ub = items.length;
    o.computed_ub_reason = null;
    o.autoPack = new Map();
    o.autoPackNBins = new Map();
    for(const [solnName, soln] of o.solutions.entries()) {
        const nBins = countUsedBins(soln);
        if(nBins < o.computed_ub) {
            o.computed_ub_reason = solnName;
            o.computed_ub = nBins;
        }
    }
    for(const algoName of ubAlgos) {
        let algo = bpAlgos.get(algoName);
        o.autoPack.set(algoName, algo(items, o.binXLen, o.binYLen, []));
        const nBins = countUsedBins(o.autoPack.get(algoName));
        o.autoPackNBins.set(algoName, nBins);
        if(nBins < o.computed_ub) {
            o.computed_ub_reason = algoName;
            o.computed_ub = nBins;
        }
    }
    if(o.upper_bound === null) {
        o.upper_bound = o.computed_ub;
    }
    if(o.lower_bound === null) {
        [o.computed_lb, o.computed_lb_reason] = bpLowerBound(items, o.binXLen, o.binYLen, false);
        o.lower_bound = o.computed_lb;
    }
    return o;
}

//==[ Level Generators ]========================================================

function hueToColor(hue) {
    return 'hsl(' + hue + ', 100%, 50%)';
}

class Parameter {
    constructor(name, defaultValue, description, convert, validationMessage, options=null) {
        this.name = name;
        this.defaultValue = defaultValue;
        this.description = description;
        this.convert = convert;
        this.validationMessage = validationMessage;
        this.options = options;
    }
}

function toParamMap(paramList) {
    let paramMap = new Map();
    for(let param of paramList) {
        paramMap.set(param.name, param);
    }
    return paramMap;
}

function positiveIntConverter(x) {
    const i = parseInt(x);
    return [!isNaN(i) && i > 0, i];
}
const positiveIntMessage = 'should be a positive integer.';

function boolConverter(x) {
    if(x === '1' || x === 'true') {
        return [true, true];
    }
    else if(x === '0' || x === 'false') {
        return [true, false];
    }
    else {
        return [false, null];
    }
}
const boolMessage = 'should be true or false.';
const boolOptions = ['true', 'false'];

function urlEncodeIdemp(x) {
    return [x.match(/^[0-9a-zA-Z_.~-]+$/), x];
}
const urlEncodeIdempMessage = 'should only contain letters, numbers, dot, hyphen, underscore, tilde.'

function validateAndConvert(q, paramMap) {
    let errors = [];
    for(let [paramName, param] of paramMap) {
        if(q[paramName] === undefined || q[paramName] === null) {
            q[paramName] = param.defaultValue;
        }
        else {
            let [convSucc, converted] = param.convert(q[paramName]);
            if(convSucc) {
                q[paramName] = converted;
            }
            else {
                errors.push(param.name + ' ' + param.validationMessage);
            }
        }
    }
    return errors;
}

function levelGenBP1(q) {
    var n = q.n, binXLen = q.xLen, binYLen = q.yLen;
    var items = [];
    var obj = {
        "binXLen": binXLen, "binYLen": binYLen,
        "gameType": "bp", "items": items,
    };
    if(q.seed === null) {
        q.seed = getRandomSeed();
    }
    var rand = getRandGen(q.seed);
    for(var i=0; i<n; ++i) {
        items.push({
            "xLen": 1 + Math.floor(Math.pow(rand(), 3) * binXLen),
            "yLen": 1 + Math.floor(Math.pow(rand(), 3) * binYLen),
            "color": hueToColor(Math.floor(rand() * 360)),
        });
    }
    return obj;
}

levelGenBP1.paramMap = toParamMap([
    new Parameter('n', 25, 'number of items', positiveIntConverter, positiveIntMessage),
    new Parameter('xLen', 8, 'xLen of bin', positiveIntConverter, positiveIntMessage),
    new Parameter('yLen', 8, 'yLen of bin', positiveIntConverter, positiveIntMessage),
    new Parameter('seed', null, 'seed for random number generator',
        urlEncodeIdemp, urlEncodeIdempMessage),
]);
levelGenBP1.info = 'Independently and randomly generate colors and dimensions of each item.'
levelGenerators.set('bp1', levelGenBP1);

//==[ Loading game ]============================================================

function applyToHttpResponse(url, hook, failHook) {
    var xhttp = new XMLHttpRequest();
    xhttp.onreadystatechange = function() {
        if(this.readyState == 4) {
            if(this.status >= 200 && this.status <= 299) {
                console.debug('received response for ' + url);
                hook(this.responseText);
            }
            else {
                console.error('status code for ' + url + ':', this.status);
                if(failHook !== null) {
                    failHook(this.status);
                }
            }
        }
    };
    xhttp.open('GET', url, true);
    xhttp.send();
}

function handleWithFailHook(e, failHook) {
    if(e instanceof InputError && failHook !== null) {
        failHook(e.message);
    }
    else {
        throw e;
    }
}

function loadGameFromRawLevel(level, scaleFactor=null, succHook=null, failHook=null) {
    let processedLevel = null;
    try {
        processedLevel = processLevel(level);
    }
    catch (e) {
        handleWithFailHook(e, failHook);
    }
    if(processedLevel !== null) {
        clearGame();
        game = new Game(processedLevel, scaleFactor);
        if(succHook !== null) {
            succHook();
        }
    }
}

function loadGameFromJsonString(levelString, scaleFactor=null, succHook=null, failHook=null) {
    let level = null;
    try {
        level = JSON.parse(levelString);
    }
    catch (e) {
        if(failHook !== null) {
            failHook('Invalid JSON: ' + e.message);
        }
        else {
            throw e;
        }
    }
    if(level !== null) {
        loadGameFromRawLevel(level, null, succHook, failHook);
    }
}

function loadGameFromUrl(url, scaleFactor=null, succHook=null, failHook=null) {
    var failHook2 = null;
    if(failHook !== null) {
        failHook2 = function(statusCode) {failHook("Network error: could not retrieve " + url
            + "; status code " + statusCode);};
    }
    applyToHttpResponse(url, function(text) {
            loadGameFromJsonString(text, scaleFactor, succHook, failHook);},
        failHook2);
}

function loadGameFromGen(genName, q, scaleFactor=null, succHook=null, failHook=null) {
    const gen = levelGenerators.get(genName);
    if(failHook === null) {
        failHook = throwInputError;
    }
    if(gen === undefined) {
        failHook('level generator ' + genName + ' not found');
    }
    else {
        let errors = validateAndConvert(q, gen.paramMap);
        if(errors.length === 0) {
            let level = null;
            try {
                level = gen(q);
            }
            catch (e) {
                handleWithFailHook(e, failHook);
            }
            if(level !== null) {
                loadGameFromRawLevel(level, scaleFactor, succHook, failHook);
            }
        }
        else {
            failHook(errors);
        }
    }
}

function loadGameFromFile(file, scaleFactor=null, succHook=null, failHook=null) {
    const reader = new FileReader();
    reader.addEventListener('load', function(ev) {
        loadGameFromJsonString(ev.target.result, scaleFactor, succHook, failHook);
    });
    if(failHook !== null) {
        reader.addEventListener('error', function(ev) {
            failHook('failed to read ' + file.name + '.')
        });
    }
    reader.readAsText(file);
}

function loadGameFromFiles(files, scaleFactor=null, succHook=null, failHook=null) {
    if(files.length > 0) {
        console.log('loading file ' + files[0].name);
        loadGameFromFile(files[0], scaleFactor, succHook, failHook);
    }
    else {
        console.log('no file given to loader');
        if(succHook !== null) {
            succHook();
        }
    }
}

function loadGameFromUpload(scaleFactor=null, succHook=null, failHook=null) {
    uploadInfo['scaleFactor'] = scaleFactor;
    uploadInfo['succHook'] = succHook;
    uploadInfo['failHook'] = failHook;
    document.getElementById('level-loader').click();
}

function getQParams() {
    var params = new URLSearchParams(window.location.search);
    var d = {};
    for(let [key, value] of params.entries()) {
        if(value !== '') {
            d[key] = value;
        }
    }
    console.debug('query params:', JSON.stringify(d));
    return d;
}

function loadGameFromQParams(q, succHook=null, failHook=null) {
    if(Object.keys(q).length === 0) {
        q['srctype'] = 'gen';
        q['src'] = 'bp1';
    }

    let scaleFactor = null;
    if(q.hasOwnProperty('scaleFactor')) {
        if(q.scaleFactor === 'x' || q.scaleFactor === 'y') {
            scaleFactor = q.scaleFactor;
        }
        else {
            scaleFactor = parseFloat(q.scaleFactor);
            if(isNaN(scaleFactor) || scaleFactor <= 0) {
                scaleFactor = null;
            }
        }
    }
    try {
        const srctype = dictAssertAccess(q, 'srctype', 'querystring');

        if(srctype === 'url') {
            const url = dictAssertAccess(q, 'src', 'querystring');
            loadGameFromUrl(url, scaleFactor, succHook, failHook);
        }
        else if(srctype === 'gen') {
            const genName = dictAssertAccess(q, 'src', 'querystring');
            loadGameFromGen(genName, q, scaleFactor, succHook, failHook);
        }
        else {
            throw new InputError('unknown srctype: ' + srctype);
        }
    }
    catch (e) {
        handleWithFailHook(e, failHook);
    }
}

//==[ Saving / Export ]=========================================================

function downloadBlob(blob, filename, cleanup=false) {
    var url = URL.createObjectURL(blob);
    var downloaderElem = document.getElementById('downloader');
    downloaderElem.href = url;
    downloaderElem.download = filename;
    downloaderElem.click();
    if(cleanup) {
        setTimeout(function() {
                downloaderElem.removeAttribute('href');
                downloaderElem.removeAttribute('download');
                window.URL.revokeObjectURL(url);
            }, 0);
    }
}

function serializeItemInfo(itemInfo) {
    var o = {"xLen": itemInfo.xLen, "yLen": itemInfo.yLen};
    if(itemInfo.color !== null) {
        o['color'] = itemInfo.color;
    }
    if(itemInfo.profit !== null && itemInfo.profit !== 0) {
        o['profit'] = itemInfo.profit;
    }
    return o;
}

function serItemsEqual(a, b) {
    return (a.xPos === b.xPos && a.yPos === b.yPos
        && a.profit === b.profit && a.color === b.color);
}

function serializeLevel(level, pos=null) {
    var o = {"binXLen": level.binXLen, "binYLen": level.binYLen,
        "gameType": level.gameType, "solutions": Object.fromEntries(level.solutions.entries()),
        "lower_bound": level.lower_bound, "upper_bound": level.upper_bound};
    if(pos !== null && pos.length > 0) {o['startPos'] = pos;}

    var serItems = [];
    o['items'] = serItems;
    var prevSerItem = null;
    for(var i=0; i < level.items.length; ++i) {
        var serItem = serializeItemInfo(level.items[i]);
        if(prevSerItem !== null && serItemsEqual(prevSerItem, serItem)) {
            var n = prevSerItem['n'];
            if(n === undefined) {
                prevSerItem['n'] = 2;
            }
            else {
                prevSerItem['n'] = n+1;
            }
        }
        else {
            serItems.push(serItem);
            prevSerItem = serItem;
        }
    }
    return o;
}

function downloadProgress(filename='progress.json', cleanup=false) {
    let level = serializeLevel(game.level, game.getItemPositions());
    let blob = new Blob([JSON.stringify(level)], {type: 'application/json'});
    downloadBlob(blob, filename, cleanup);
}

function getItemColor(itemId) {
    if(game === null) {
        return null;
    }
    else {
        let colorCode = window.getComputedStyle(game.items[itemId].domElem).backgroundColor;
        let [red, green, blue] = colorCode.match(/\d+/g).map(function(x) {return parseInt(x);});
        return ((1 << 24) + (red << 16) + (green << 8) + blue).toString(16).substr(1);
    }
}

var defaultTikzOptions = {
    'cellSize': '1cm',
    'margin': '0.1cm',
    'mirror': true,
    'wrap': true,
};

function getCellAndMarginSize() {
    var pxInCm = window.outerWidth / 21;
    var margin = (innerMargin / 2 / pxInCm) + 'cm';
    var cellSize = (game.scaleFactor / pxInCm) + 'cm';
    return [cellSize, margin];
}

function binsToTikz(level, pos, options={}) {
    if(pos.length === 0) {
        console.warn('binsToTikz: no packed items.');
    }
    const n = level.items.length;
    let m = 0;
    let children = [];
    for(let i=0; i < pos.length && i < n; ++i) {
        if(pos[i] !== undefined && pos[i] !== null) {
            let [binId, xPos, yPos] = pos[i];
            m = Math.max(m, binId+1);
            if(children[binId] === undefined) {
                children[binId] = [];
            }
            children[binId].push(i);
        }
    }
    for(let j=0; j<m; ++j) {
        if(children[j] === undefined) {
            children[j] = [];
        }
    }

    if(game !== null) {
        let [computedCellSize, computedMargin] = getCellAndMarginSize();
        if(options['cellSize'] === undefined) {
            options['cellSize'] = computedCellSize;
        }
        if(options['margin'] === undefined) {
            options['margin'] = computedMargin;
        }
    }
    for(let key in defaultTikzOptions) {
        if(defaultTikzOptions.hasOwnProperty(key)) {
            if(options[key] === undefined) {
                options[key] = defaultTikzOptions[key];
            }
        }
    }

    let lines = [
'\\ifcsname pGameL\\endcsname\\else\\newlength{\\pGameL}\\fi',
'\\ifcsname pGameM\\endcsname\\else\\newlength{\\pGameM}\\fi',
`\\setlength{\\pGameL}{${options['cellSize']}}`,
`\\setlength{\\pGameM}{${options['margin']}}`,
`\\definecolor{defaultItemColor}{HTML}{${defaultItemColorTikz}}`,
'\\tikzset{bin/.style={draw,thick}}',
'\\tikzset{binGrid/.style={draw,step=1\\pGameL,{black!20}}}',
'\\tikzset{item/.style={draw,fill=defaultItemColor}}',
];
    for(let j=0; j<m; ++j) {
        lines.push('\\begin{tikzpicture}');
        lines.push('\\path (-\\pGameM, -\\pGameM) rectangle '
            + `(${level.binXLen}\\pGameL+\\pGameM, ${level.binYLen}\\pGameL+\\pGameM);`);
        lines.push('\\path[binGrid] (0\\pGameL, 0\\pGameL) grid '
            + `(${level.binXLen}\\pGameL, ${level.binYLen}\\pGameL);`);
        for(let i of children[j]) {
            const xLen = level.items[i].xLen;
            const yLen = level.items[i].yLen;
            let [binId, xPos, yPos] = pos[i];
            if(options['mirror']) {
                yPos = level.binYLen - yPos - yLen;
            }
            let colorStyleStr = '';
            if(level.items[i].color !== null) {
                const color = getItemColor(i);
                if(color !== null) {
                    lines.push(`\\definecolor{currentItemColor}{HTML}{${color}}`);
                    colorStyleStr = ',fill=currentItemColor';
                }
            }
            lines.push(`\\path[item${colorStyleStr}] (${xPos}\\pGameL, ${yPos}\\pGameL) rectangle `
                + `+(${xLen}\\pGameL, ${yLen}\\pGameL);`);
        }
        lines.push('\\path[bin] (0\\pGameL, 0\\pGameL) rectangle '
            + `(${level.binXLen}\\pGameL, ${level.binYLen}\\pGameL);`);
        if(options['wrap']) {
            lines.push('\\end{tikzpicture}');
        }
        else {
            lines.push('\\end{tikzpicture}%');
        }
    }
    return lines.join('\n');
}

function downloadBinsToTikz(options={}, filename='bins.tikz', cleanup=false) {
    var tikz = binsToTikz(game.level, game.getItemPositions(), options);
    var blob = new Blob([tikz], {type: 'application/x-tex'});
    downloadBlob(blob, filename, cleanup);
}