const properties = new Properties({});

window.addEventListener("load", function () {
    update(document.documentElement);
});

const register = {};
const contexts = new Map();


// return the context of the element
function getContext(el) {
    if (el == document.documentElement)
        return properties;
    return contexts.get(el) || getContext(el.parentElement);
}

// 
function updateContext(el, data, equivalents) {
    if (!contexts.has(el))
        contexts.set(el, new Context(el));
    for (let k in data)
        contexts.get(el)[Context.put](k, data[k]);
    for (let k in equivalents)
        contexts.get(el)[Context.setEq](k, equivalents[k]);
}

// remove lost contexts and lost register entries (of removed elements)
function clean() {
    for (let el of contexts.keys())
        if (!document.contains(el))
            contexts.delete(el);
    for (let updateName in register)
        for (let el of register[updateName])
            if (!document.contains(el))
                register[updateName].delete(el);
}

function update(el) {
    var context = getContext(el);
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
        showHide(el, condition, el.dataset.transition, el.dataset.transitionTime);
        updateAfterIf(el, condition, context, el.dataset.transition, el.dataset.transitionTime);
    }

    // data-ignore attribute
    if ("ignore" in el.dataset)
        return;

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

        // data-foreach-* attribute
        if (attr.startsWith("foreach")) {
            let iVar = attr.replace("foreach", "").charAt(0).toLowerCase() + attr.replace("foreach", "").slice(1);
            // if first run
            if (el.dataset.content == undefined) {
                el.dataset.content = el.innerHTML;
                el.innerHTML = "";
            }
            let array = evalExpression(el.dataset[attr], el);
            if (!array || typeof array.entries !== "function") {
                console.error("`" + el.dataset[attr] + "` is not iterable", array);
            }
            let children = getChildren(el);
            let arrayElements = [];
            exploreChildren: for (let child of children) {
                let item = evalExpression(iVar, child);
                for (let [i, value] of array.entries()) {
                    if (item[Properties.target] === value[Properties.target]) {
                        arrayElements[i] = child;
                        continue exploreChildren;
                    }
                }
                // remove child
                child.dataset.ignore = "";
                leaveTransition(child, el.dataset.transition, el.dataset.transitionTime)
                .then(() => child.remove());
            }
            for (let i = 0; i < array.length; i++) {
                children = getChildren(el);
                if (arrayElements[i]) {
                    // updating existing elements
                    updateContext(children[i], {
                        [el.dataset.index]: i
                    }, {
                        [iVar]: el.dataset[attr] + "." + i
                    });
                    update(children[i]);
                } else {
                    // adding new elements
                    if (i == 0) el.insertAdjacentHTML("afterbegin", el.dataset.content);
                    else children[i-1].insertAdjacentHTML("afterend", el.dataset.content);
                    let newChild = i==0 ? el.firstElementChild : children[i-1].nextElementSibling;
                    updateContext(newChild, {
                        [iVar]: array[i],
                        [el.dataset.index]: i
                    }, {
                        [iVar]: el.dataset[attr] + "." + i
                    });
                    update(newChild);
                    enterTransition(newChild, el.dataset.transition, el.dataset.transitionTime);
                }
            }
            updateChildren = false;
        }
    }

    // data-repeat attribute
    if (el.dataset.repeat) {
        // if first run
        if (el.dataset.content == undefined) {
            el.dataset.content = el.innerHTML;
            el.innerHTML = "";
        }
        let repeat = evalExpression(el.dataset.repeat, el);
        let last = getChildren(el).length;
        if (repeat > last) {
            // adding new elements
            for (let i = last; i < repeat; i++)
                el.insertAdjacentHTML("beforeend", el.dataset.content);
            let children = getChildren(el);
            for (let i = last; i < repeat; i++) {
                updateContext(children[i], {
                    [el.dataset.index]: i,
                });
                update(children[i]);
                enterTransition(children[i], el.dataset.transition, el.dataset.transitionTime)
            }
        } else {
            // or removing excess elements
            let children = getChildren(el);
            for (let i = repeat; i < last; i++) {
                children[i].dataset.ignore = "";
                leaveTransition(children[i], el.dataset.transition, el.dataset.transitionTime)
                    .then(child => child.remove());
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

    clean();
}

function updateAfterIf(el, ifCondition, context, transition=null, transitionTime=null) {
    // data-elif attribute
    if (el.nextElementSibling?.dataset?.elif != undefined) {
        if (!ifCondition) {
            let condition = evalExpression(el.nextElementSibling.dataset.elif, el);
            showHide(el.nextElementSibling, condition, transition, transitionTime);
            updateAfterIf(el.nextElementSibling, condition, context, transition, transitionTime);
        } else {
            showHide(el.nextElementSibling, false, transition, transitionTime);
            updateAfterIf(el.nextElementSibling, true, context, transition, transitionTime);
        }
    }
    // data-else attribute
    else if (el.nextElementSibling?.dataset?.else != undefined) {
        showHide(el.nextElementSibling, !ifCondition, transition, transitionTime);
    }
}

function onModelInput(event) {
    evalExpression(event.target.dataset.model + " = this.type == 'checkbox' ? this.checked : ['INPUT','SELECT','TEXTAREA'].includes(this.tagName) ? this.value : this.innerText", event.target);
}

function onEvent(event) { // TODO : add modifiers like .once, .prevent, .stop, .capture, .passive
    var expression = event.target.dataset["on" + event.type.charAt(0).toUpperCase() + event.type.slice(1)];
    evalExpression(expression, event.target);
}

function showHide(el, showCondition, transition=null, time=500) {
    if (showCondition) {
        enterTransition(el, transition, time).then(() => el.style.display = "");
        delete el.dataset.ignore;
    } else {
        leaveTransition(el, transition, time).then(() => el.style.display = "none");
        el.dataset.ignore = "";
    }
}

// remove element with transition
function leaveTransition(el, transition=null, time=500) {
    return new Promise(resolve => {
        if (transition === null) return resolve(el);
        if (transition == "") {
            el.style.transition = "opacity 0." + time / 2 + "s";
            el.style.opacity = 0;
            setTimeout(() => resolve(el), time/2);
        } else {
            el.classList.add(transition + "-leave");
            el.offsetHeight; // force reflow css
            el.classList.add(transition + "-leave-active");
            el.classList.remove(transition + "-leave");
            el.classList.add(transition + "-leave-to");
            setTimeout(() => {
                el.classList.remove(transition + "-leave-to");
                el.classList.remove(transition + "-leave-active");
                resolve(el);
            }, time);
        }
    });
}

// add element with transition
function enterTransition(el, transition=null, time=500) {
    return new Promise(resolve => {
        if (transition === null) return resolve(el);
        if (transition == "") {
            el.style.opacity = 0;
            el.style.transition = "opacity 0." + time / 2 + "s";
            el.offsetHeight; // force reflow css
            el.style.opacity = 1;
            setTimeout(() => resolve(el), time);
        } else {
            el.classList.add(transition + "-enter");
            el.offsetHeight; // force reflow css
            el.classList.add(transition + "-enter-active");
            el.classList.remove(transition + "-enter");
            el.classList.add(transition + "-enter-to");
            setTimeout(() => {
                el.classList.remove(transition + "-enter-to");
                el.classList.remove(transition + "-enter-active");
                resolve(el);
            }, time);
        }
    });
}

function getChildren(el) {
    return Array.from(el.children).filter(child => !("ignore" in child.dataset));
}

function updateProp(prop) {
    //console.log("Update: " + prop);
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
    do {
        var path = prop.split(".");
        prop = path[0];
        var found = true;
        for (let i = 1; i < path.length; i++) {
            if (context[Context.getEq] && context[Context.getEq](prop)) {
                prop = context[Context.getEq](prop);
                found = false;
            }
            prop += "." + path[i];
        }
        if (context[Context.getEq] && context[Context.getEq](prop)) {
            prop = context[Context.getEq](prop);
            found = false;
        }
    } while (!found);
    return prop;
}

function Properties(obj = {}, parent = null) {
    for (key in obj) {
        if (obj[key] === null || obj[key] === undefined) continue;
        if (obj[key][Properties.target])
            obj[key] = new Properties(obj[key][Properties.target], parent ? parent + "." + key : key);
        else if (obj[key] instanceof Object)
            obj[key] = new Properties(obj[key], parent ? parent + "." + key : key);
    }
    return new Proxy(obj, {
        set(obj, prop, value) {
            if (obj[prop] !== value || !(prop in obj)) {
                var updateLength = obj instanceof Array && prop.match(/^[0-9]+$/) && parseInt(prop) >= obj.length;
                obj[prop] = value===undefined || value===null ? value
                    : value[Properties.target] ? new Properties(value[Properties.target], parent ? parent + "." + prop : prop)
                        : value instanceof Object ? new Properties(value, parent ? parent + "." + prop : prop)
                            : value;
                if (updateLength) updateProp(parent ? parent + ".length" : "length");
                updateProp(parent ? parent + "." + prop : prop);
            }
            return true;
        },
        get(obj, prop) {
            if (prop == Properties.target)
                return obj;
            return obj[prop]
        }
    });
}
Properties.target = Symbol("target");

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

function Context(el) {
    var obj = {};
    var equivalents = {};
    var ctx = new Proxy(obj, {
        set(obj, prop, value) {
            if ([Context.setEq, Context.put, Context.getEq].includes(prop) || prop in obj) {
                obj[prop] = value;
            } else {
                getContext(el.parentElement)[prop] = value;
            }
        },
        get(obj, prop, receiver) {
            if ([Context.setEq, Context.put, Context.getEq].includes(prop) || prop in obj) {
                return obj[prop];
            } else {
                return getContext(el.parentElement)[prop];
            }
        },
        ownKeys(obj) {
            return Object.keys(obj).concat(Object.keys(getContext(el.parentElement)));
        },
        has(obj, key) {
            return key in obj || key in getContext(el.parentElement);
        }
    });
    ctx[Context.put] = function (prop, value) {
        obj[prop] = value;
    }
    ctx[Context.setEq] = function (prop, equivalent) {
        equivalents[prop] = equivalent;
    };
    ctx[Context.getEq] = function (prop) {
        return equivalents[prop];
    };
    return ctx;
}
Context.setEq = Symbol("setEquivalent");
Context.getEq = Symbol("getEquivalent");
Context.put = Symbol("put");