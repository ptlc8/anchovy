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
        el.setAttribute("data-bind", el.dataset.model);
        var updateSet = new Set(el.getAttribute("data-update") ? el.getAttribute("data-update").split("|") : []);
        updateSet.add(el.dataset.model)
        el.setAttribute("data-update", [...updateSet].join("|"));
        el.setAttribute("oninput", "onInput(this,'" + el.dataset.model + "')");
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
        let condition = evalContext(el.dataset.if, context);
        showHide(el, condition);
        updateAfterIf(el, condition, context);
    }

    // data-bind attribute
    if (el.dataset.bind) {
        let value = evalContext(el.dataset.bind, context);
        if ("INPUT" == el.tagName) {
            el[el.type == "checkbox" ? "checked" : "value"] = value;
        } else if ("SELECT" == el.tagName) {
            el.value = value;
        } else if (el.innerText != value)
            el.innerText = value;
    }

    for (let attr in el.dataset) {
        // data-on-* attributes
        if (attr.startsWith("on")) {
            let eventName = camelToKebab(attr.replace("on", ""));
            el.setAttribute("on" + eventName, "evalContext(this.dataset." + attr + ", getContext(this))");
        }

        // data-bind-* attributes
        if (attr.startsWith("bind") && attr != "bind") {
            let bindingAttr = camelToKebab(attr.replace("bind", ""));
            el.setAttribute(bindingAttr, evalContext(el.dataset[attr], context));
        }
    }

    // data-for-test attribute
    if (el.dataset.forTest) {
        // if first run
        if (el.dataset.forContent == undefined)
            el.dataset.forContent = el.innerHTML;
        el.innerHTML = "";
        evalContext(el.dataset.forInit, context);
        let updatedCount = 0;
        for (let index = 0; evalContext(el.dataset.forTest, context); index++) {
            el.insertAdjacentHTML("beforeend", el.dataset.forContent);
            while (updatedCount < el.children.length) {
                //el.children[updatedCount].dataset.varIndex = index;
                update(el.children[updatedCount++]);
            }
            evalContext(el.dataset.forNext, context);
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
        let array = evalContext(el.dataset.forIn, context);
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
        setInnerHTML(el, evalContext(el.dataset["html"], context));
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
            let condition = evalContext(el.nextElementSibling.dataset.elif, context);
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

function onInput(el, prop) {
    evalContext(prop + " = el.type == 'checkbox' ? el.checked : ['INPUT','SELECT'].includes(el.tagName) ? el.value : el.innerText", getContext(el), { el });
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

function evalContext(js, context, args = {}) {
    try {
        //return eval("with (context) {" + js + "}");
        /*return Function(...Object.keys(context), ...Object.keys(args), "return " + js)
            .call(context, ...Object.values(context), ...Object.values(args));*/
        return Function(...Object.keys(args), "return " + js)
            .call(context, ...Object.values(args));
    } catch (e) {
        throw `${e.name} : ${e.message}\n\t${js}`;
    }
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
function Properties(obj = {}, parent = "this") {
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