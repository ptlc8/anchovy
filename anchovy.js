const properties = new Properties({});

window.addEventListener("load", function () {
    update(document.children[0]);
});

const register = {};
const contexts = new Map();


function getContext(el) {
    if (el == document.children[0])
        return properties;
    if (contexts.get(el))
        return contexts.get(el);
    var context = new Context(getContext(el.parentElement));
    contexts.set(el, context);
    return context;
}

function update(el, newProperties) {
    var context = getContext(el);
    for (let key in newProperties) {
        context[variables].push(key);
        context[key] = newProperties[key];
    }

    var updateChildren = true;

    // data-model
    if (el.dataset.model) {
        el.dataset.bind = el.dataset.model;
        var updateSet = new Set(el.getAttribute("data-update") ? el.getAttribute("data-update").split("|") : []);
        updateSet.add(el.dataset.model)
        el.dataset.update = [...updateSet].join("|");
        el.removeEventListener("input", onModelInput);
        el.addEventListener("input", onModelInput);
    }

    // data-update : if updatable add it to registry
    if (el.dataset.update) {
        for (let updateName of findUpdatesName(context, el.dataset.update)) {
            if (!register[updateName])
                register[updateName] = new Set([el]);
            else
                register[updateName].add(el);
        }
    }

    // data-if attribute
    if (el.dataset.if) {
        let condition = evalExpression(el.dataset.if, el);
        showHide(el, condition);
        updateAfterIf(el, condition, context);
    }

    // data-bind attribute
    if (el.dataset.bind) {
        let value = evalExpression(el.dataset.bind, el);
        if ("INPUT" == el.tagName) {
            el[el.type == "checkbox" ? "checked" : "value"] = value;
        } else if (["TEXTAREA", "SELECT"].includes(el.tagName)) {
            el.value = value;
        } else if (el.innerText !== value)
            el.innerText = value;
    }

    for (let attr in el.dataset) {
        // data-on-* attributes
        if (attr.startsWith("on")) {
            //let eventName = camelToKebab(attr.replace("on", ""));
            let eventName = attr.replace("on", "").toLowerCase();
            el.removeEventListener(eventName, onEvent);
            el.addEventListener(eventName, onEvent);
        }

        // data-bind-* attributes
        if (attr.startsWith("bind") && attr != "bind") {
            let bindingAttr = camelToKebab(attr.replace("bind", ""));
            el.setAttribute(bindingAttr, evalExpression(el.dataset[attr], el));
        }
    }

    // data-repeat attribute
    if (el.dataset.repeat) {
        // if first run
        if (el.dataset.repeatContent == undefined) {
            el.dataset.repeatContent = el.innerHTML;
            el.innerHTML = "";
        }
        let repeat = evalExpression(el.dataset.repeat, el);
        if (repeat > el.children.length) {
            let last = el.children.length;
            for (let i = last; i < repeat; i++)
                el.insertAdjacentHTML("beforeend", el.dataset.repeatContent);
            for (let i = last; i < repeat; i++)
                update(el.children[i], {
                    [el.dataset.repeatIndex]: i,
                });
        } else {
            for (let i = repeat; i < el.children.length; i++)
                el.children[i].remove();
        }
        updateChildren = false;
    }

    // data-for-each attribute
    if (el.dataset.forEach && el.dataset.forIn) {
        // if first run
        if (el.dataset.forContent == undefined)
            el.dataset.forContent = el.innerHTML;
        el.innerHTML = "";
        let updatedCount = 0;
        let array = evalExpression(el.dataset.forIn, el);
        for (const [index, item] of array.entries()) {
            el.insertAdjacentHTML("beforeend", el.dataset.forContent);
            while (updatedCount < el.children.length) {
                //el.children[updatedCount].dataset.varIndex = index;
                update(el.children[updatedCount++],
                    {
                        [el.dataset.forEach]: item, [el.dataset.forIndex]: index,
                        ["_eq_this." + el.dataset.forEach]: el.dataset.forIn + "." + index, ["_eq_this." + el.dataset.forIndex]: el.dataset.forIn + "." + index
                    });
            }
        }
        updateChildren = false;
    }

    // data-html attribute
    if (el.dataset.html) {
        setInnerHTML(el, evalExpression(el.dataset.html, el));
    }

    // Update children
    if (updateChildren)
        for (let child of el.children)
            update(child);

    // data-include data-view attribute
    if (el.dataset.view) {
        fetch(el.dataset.view)
            .then(resp => resp.text())
            .then(html => {
                setInnerHTML(el, html);
                for (let child of el.children) {
                    update(child);
                }
            });
    }
}

function updateAfterIf(el, condition, context) {
    // data-elif attribute
    if (el.nextElementSibling?.dataset?.elif != undefined) {
        if (!condition) {
            let condition = evalExpression(el.nextElementSibling.dataset.elif, el);
            showHide(el.nextElementSibling, condition);
            updateAfterIf(el.nextElementSibling, condition, context);
        } else {
            showHide(el.nextElementSibling, false);
            updateAfterIf(el.nextElementSibling, true, context);
        }
    }
    // data-else attribute
    else if (el.nextElementSibling?.dataset?.else != undefined) {
        showHide(el.nextElementSibling, !condition);
    }
}

function onModelInput(event) {
    evalExpression(event.target.dataset.model + " = this.type == 'checkbox' ? this.checked : ['INPUT','SELECT','TEXTAREA'].includes(this.tagName) ? this.value : this.innerText", event.target);
}

function onEvent(event) { // TODO : add modifiers like .once, .prevent, .stop, .capture, .passive
    var expression = event.target.dataset["on" + event.type.charAt(0).toUpperCase() + event.type.slice(1)];
    evalExpression(expression, event.target);
}

function showHide(el, showCondition) {
    el.style.display = showCondition ? "" : "none";
}

function updateProp(prop) {
    //prop = prop.match(/^this\.[^\.]+|^[^\.]+/); // TMP
    console.log("Update: " + prop);
    for (let el of register[prop] || [])
        update(el);
}

function evalExpression(js, element) {
    return new Function("_context", "with (_context) { return " + js + " }")
        .call(element, getContext(element));
}

function findUpdatesName(context, props) {
    return props.split("|").map(p => findUpdateName(context, p));
}

function findUpdateName(context, prop) {
    var bind = prop;
    do {
        prop = bind.split(".");
        var bind = prop[0];
        var found = true;
        for (let i = 1; i < prop.length; i++) {
            if (context["_eq_" + bind]) {
                bind = context["_eq_" + bind];
                found = false;
            }
            bind += "." + prop[i];
        }
        if (context["_eq_" + bind]) {
            bind = context["_eq_" + bind];
            found = false;
        }
    } while (!found);
    return bind;
}

const target = Symbol("target");
function Properties(obj = {}, parent = null) {
    for (key in obj) {
        if (obj[key][target])
            obj[key] = new Properties(obj[key][target], parent ? parent + "." + key : key);
        else if (obj[key] instanceof Object)
            obj[key] = new Properties(obj[key], parent ? parent + "." + key : key);
    }
    return new Proxy(obj, {
        set(obj, prop, value) {
            if (obj[prop] !== value) {
                var updateLength = obj instanceof Array && prop.match(/^[0-9]+$/) && parseInt(prop)+1 > obj.length;
                obj[prop] = value[target] ? new Properties(value[target], parent ? parent + "." + prop : prop)
                    : value instanceof Object ? new Properties(value, parent ? parent + "." + prop : prop)
                        : value;
                if (updateLength) updateProp(parent ? parent + ".length" : "length");
                updateProp(parent ? parent + "." + prop : prop);
            }
            return true;
        },
        get(obj, prop) {
            if (prop == target)
                return obj;
            return obj[prop]
        }
    });
}

function camelToKebab(str) {
    return str.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

function setInnerHTML(el, html) {
    el.innerHTML = html;
    Array.from(el.querySelectorAll("script")).forEach(oldScript => {
        const newScript = document.createElement("script");
        Array.from(oldScript.attributes)
            .forEach(attr => newScript.setAttribute(attr.name, attr.value));
        newScript.appendChild(document.createTextNode(oldScript.innerHTML));
        oldScript.parentNode.replaceChild(newScript, oldScript);
    });
}

const context = Symbol("context");
const variables = Symbol("variables");
const olds = Symbol("olds");
const hasChanged = Symbol("hasChanged");
const updateSymbol = Symbol("update");
const equivalentsSymbol = Symbol("quivalents");
function Context(parentContext) {
    var ctx = new Proxy({}, {
        set(obj, prop, value) {
            if ([context, variables, olds, hasChanged, updateSymbol, equivalentsSymbol].includes(prop) || ctx[variables].includes(prop)) {
                obj[prop] = value;
            } else {
                ctx[context][prop] = value;
            }
        },
        get(obj, prop, receiver) {
            if ([context, variables, olds, hasChanged, updateSymbol, equivalentsSymbol].includes(prop) || ctx[variables].includes(prop)) {
                return obj[prop];
            } else {
                return ctx[context][prop];
            }
        },
        ownKeys(obj) {
            return Object.keys(obj).concat(Object.keys(ctx[context]));
        },
        getOwnPropertyDescriptor(obj, prop) {
            return {
                enumerable: true,
                configurable: true
            };
        },
        has(obj, key) {
            return key in obj || key in ctx[context];
        }
    });
    ctx[context] = parentContext;
    ctx[variables] = [];
    ctx[olds] = null;
    ctx[hasChanged] = function () {
        if (ctx[olds] == null) return true;
        for (let key in ctx[variables])
            if (ctx[variables][key] != ctx[olds][key])
                return true;
        return false;
    };
    ctx[updateSymbol] = function () {
        ctx[olds] = [];
        for (let key in ctx[variables])
            ctx[olds][key] = ctx[variables][key];
    };
    ctx[equivalentsSymbol] = {};
    return ctx;
}