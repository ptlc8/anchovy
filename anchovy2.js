"use strict";
var Anchovy = function() {

    var scopes = new Map();
    var views = new Map();

    // Model class
    function Model(data = {}) {
        var element = document.documentElement;
        if (document.currentScript?.dataset?.isView) {
            element = document.currentScript.parentElement;
            while (element.dataset.view == undefined)
                element = element.parentElement;
        }
        if (scopes.get(element) !== undefined)
            throw "Model already defined for this document or view !";
        var proxy = new Proxy(data, {
            set: function (target, name, value) {
                target[name] = value;
                console.log("Update " + name + " !");
                update(element, name);
                return true;
            }
        });
        scopes.set(element, proxy);
        return proxy;
    }

    // represents a scope of variables
    function Scope(parentScope = {}, data = {}) {
        let target = {};
        var proxy = new Proxy(target, {
            get: function (target, name) {
                return name in target ? target[name] : parentScope[name];
            },
            set: function (target, name, value) {
                if (name in target || name == "put")
                    target[name] = value;
                else
                    parentScope[name] = value;
                return true;
            },
            has: function (target, name) {
                return name in target || name in parentScope;
            },
            ownKeys: function (target) {
                return Object.keys(target).concat(Object.keys(parentScope));
            },
            enumerate: function (target) {
                return Object.keys(target).concat(Object.keys(parentScope));
            }
        });
        proxy.put = function (name, value) {
            target[name] = value;
        }
        return proxy;
    }

    // return scope of an element
    function getScope(el) {
        if (el == null)
            return globalThis;
        return scopes.get(el) || getScope(el.parentElement);
    }

    // update scope of an element
    function updateScope(el, data) {
        if (!scopes.has(el))
            scopes.set(el, Scope(getScope(el.parentElement)));
        for (let k in data) scopes.get(el).put(k, data[k]);
    }

    // remove lost scopes (scopes of removed elements)
    function cleanScopes() {
        for (let el of scopes.keys())
            if (!document.documentElement.contains(el))
                scopes.delete(el);
    }

    // eval expression in scope
    function evalExpression(expression, element) {
        return new Function("_scope", "with(_scope) { return " + expression + " }").call(element, getScope(element));
    }

    // update a DOM element and its children, TODO: if variable is specified, only update elements that depend on this variable
    function update(el, variable=null) {
        var updateChildren = true;
    
        // data-model
        if (shouldUpdate(el.dataset.model, variable)) {
            el.dataset.bind = el.dataset.model;
            //var updateSet = new Set(el.dataset.update ? el.dataset.update.split("|") : []);
            //updateSet.add(el.dataset.model);
            //el.dataset.update = [...updateSet].join("|");
            el.removeEventListener("input", onInput);
            el.addEventListener("input", onInput);
        }
    
        // data-if attribute
        if (shouldUpdate(el.dataset.if, variable)) {
            let condition = evalExpression(el.dataset.if, el);
            showHide(el, condition);
            updateAfterIf(el, condition);
        }
    
        // data-bind attribute
        if (shouldUpdate(el.dataset.bind, variable)) {
            console.log("binding "+el.dataset.bind+" for " + variable + " !")
            let value = evalExpression(el.dataset.bind, el);
            if ("INPUT" == el.tagName) {
                el[el.type == "checkbox" ? "checked" : "value"] = value;
            } else if (["SELECT", "TEXTAREA"].includes(el.tagName)) {
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
            if (attr.startsWith("bind") && attr != "bind" && shouldUpdate(el.dataset[attr], variable)) {
                let bindingAttr = camelToKebab(attr.replace("bind", ""));
                el.setAttribute(bindingAttr, evalExpression(el.dataset[attr], el));
            }
        }

        // data-repeat attribute
        if (shouldUpdate(el.dataset.repeat, variable)) {
            // if first run
            if (el.dataset.repeatContent == undefined) {
                el.dataset.repeatContent = el.innerHTML;
                el.innerHTML = "";
            }
            let repeat = evalExpression(el.dataset.repeat, el);
            if (repeat > el.children.length) {
                let last = el.children.length;
                for (let index = el.children.length; index < repeat; index++) {
                    el.insertAdjacentHTML("beforeend", el.dataset.repeatContent);
                    updateScope(el.lastElementChild, {
                        [el.dataset.repeatIndex]: index
                    });
                }
                for (let i = last; i < el.children.length; i++) {
                    update(el.children[i]);
                }
            } else if (repeat < el.children.length) {
                for (let index = el.children.length - 1; index >= repeat; index--)
                    el.children[index].remove();
            }
            updateChildren = false;
        }

        // data-for-each attribute // TODO: optimize
        if (el.dataset.forEach && shouldUpdate(el.dataset.forIn, variable)) {
            // if first run
            if (el.dataset.forContent == undefined)
                el.dataset.forContent = el.innerHTML;
            el.innerHTML = "";
            let updatedCount = 0;
            let array = evalExpression(el.dataset.forIn, el);
            for (const [index, item] of array.entries()) {
                el.insertAdjacentHTML("beforeend", el.dataset.forContent);
                while (updatedCount < el.children.length) {
                    updateScope(el.children[updatedCount], {
                        [el.dataset.forEach]: item,
                        [el.dataset.forIndex]: index
                    });
                    update(el.children[updatedCount]);
                    updatedCount++;
                }
            }
            updateChildren = false;
        }

        // data-html attribute
        if (shouldUpdate(el.dataset.html, variable)) {
            setInnerHTML(el, evalExpression(el.dataset.html, el), "isHtml");
        }

        // Update children
        if (updateChildren)
            for (let child of el.children)
                update(child, variable);

        // data-include data-view attribute
        if (el.dataset.view && !("loaded" in el.dataset)) {
            el.dataset.loaded = true;
            fetch(el.dataset.view)
                .then(resp => resp.text())
                .then(html => {
                    setInnerHTML(el, html, "isView");
                    for (let child of el.children) {
                        update(child);
                    }
                });
        }

        cleanScopes();
    }

    function shouldUpdate(data, variable) {
        return data && (!variable || data == variable || !data.match(/^[a-z0-9_]+$/i));
    }

    // when a model input changes, update the model
    function onInput(event) {
        evalExpression(event.target.dataset.model + " = this.type == 'checkbox' ? this.checked : ['INPUT','SELECT','TEXTAREA'].includes(this.tagName) ? this.value : this.innerText;", event.target);
    }

    // when a event is triggered, eval the expression
    function onEvent(event) { // TODO : add modifiers like .once, .prevent, .stop, .capture, .passive
        var expression = event.target.dataset["on" + event.type.charAt(0).toUpperCase() + event.type.slice(1)];
        evalExpression(expression, event.target);
    }

    // update elements after an if: elif or else
    function updateAfterIf(el, condition) {
        // data-elif attribute
        if (el.nextElementSibling?.dataset?.elif != undefined) {
            if (!condition) {
                let condition = evalExpression(el.nextElementSibling.dataset.elif, el.nextElementSibling);
                showHide(el.nextElementSibling, condition);
                updateAfterIf(el.nextElementSibling, condition);
            } else {
                showHide(el.nextElementSibling, false);
                updateAfterIf(el.nextElementSibling, true);
            }
        }
        // data-else attribute
        else if (el.nextElementSibling?.dataset?.else != undefined) {
            showHide(el.nextElementSibling, !condition);
        }
    }

    // show or hide an element
    function showHide(el, showCondition) { // TODO : transitions
        el.style.display = showCondition ? "" : "none";
    }

    // set innerHTML of an element and fix scripts
    function setInnerHTML(el, html, tag=null) {
        el.innerHTML = html;
        Array.from(el.querySelectorAll("script")).forEach(oldScript => {
            const newScript = document.createElement("script");
            if (tag !== null)
                newScript.dataset[tag] = true;
            Array.from(oldScript.attributes)
                .forEach(attr => newScript.setAttribute(attr.name, attr.value));
            newScript.appendChild(document.createTextNode("(function(){ " + oldScript.innerHTML + " })();"));
            oldScript.parentNode.replaceChild(newScript, oldScript);
        });
    }

    // convert camelCase to kebab-case
    function camelToKebab(str) {
        return str.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
    }
    
    window.addEventListener("load", function () {
        update(document.documentElement);
    });

    return { Model, update, scopes, getScope, evalExpression, Scope, views /* TODO remove */ };
}();


/*
function updateProp(prop) {
    //prop = prop.match(/^this\.[^\.]+|^[^\.]+/); // TMP
    console.log("Update: " + prop);
    for (let el of register[prop] || [])
        update(el);
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
}*/