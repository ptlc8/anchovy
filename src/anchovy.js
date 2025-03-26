/**
 * Variables context for an HTML element
 * @extends {Proxy}
 */
class Context {
    static target = Symbol("target");
    static equivalents = Symbol("equivalents");
    static getEquivalent = Symbol("getEquivalent");
    /**
     * @param {App} app the application where the context is defined
     * @param {HTMLElement} el the HTML element related to the context
     */
    constructor(app, el) {
        /**
         * Local context variables
         * @type {Object}
         */
        this[Context.target] = this;
        /**
         * Equivalent data names
         * @type {Object<string, string>}
         */
        this[Context.equivalents] = {};
        var ctx = new Proxy(this, {
            set(obj, prop, value) {
                if ([Context.target, Context.equivalents].includes(prop)) {
                    throw new Error("Cannot set " + prop + " property");
                } else if (prop in obj) {
                    obj[prop] = value;
                } else {
                    app.getContext(el.parentElement)[prop] = value;
                }
                return true;
            },
            get(obj, prop, receiver) {
                if ([Context.target, Context.equivalents].includes(prop) || prop in obj) {
                    return obj[prop];
                } else if (prop == Context.getEquivalent) {
                    return function (prop) {
                        if (obj[Context.equivalents][prop])
                            return obj[Context.equivalents][prop];
                        else if (app.getContext(el.parentElement)[Context.getEquivalent])
                            return app.getContext(el.parentElement)[Context.getEquivalent](prop);
                        else return null;
                    };
                } else {
                    return app.getContext(el.parentElement)[prop];
                }
            },
            ownKeys(obj) {
                return Object.keys(obj).concat(Object.keys(app.getContext(el.parentElement)));
            },
            has(obj, key) {
                return key in obj || key in app.getContext(el.parentElement);
            }
        });
        return ctx;
    }

    /**
     * Find all update names in a string
     * @param {string} props for example "user.name|user.age"
     * @returns {string[]}
     */
    findUpdatesName(props) {
        return props.split("|").map(p => this.findUpdateName(p));
    }

    /**
     * Find update name in a string
     * @param {string} prop for example "user.name"
     * @returns {string}
     */
    findUpdateName = function (prop) {
        do {
            var path = prop.split(".");
            prop = path[0];
            var found = true;
            for (let i = 1; i < path.length; i++) {
                if (this[Context.getEquivalent] && this[Context.getEquivalent](prop)) {
                    prop = this[Context.getEquivalent](prop);
                    found = false;
                }
                prop += "." + path[i];
            }
            if (this[Context.getEquivalent] && this[Context.getEquivalent](prop)) {
                prop = this[Context.getEquivalent](prop);
                found = false;
            }
        } while (!found);
        return prop;
    }
}

/**
 * @constructor
 * @param {App} app the application where the Properties is defined
 * @param {any} obj data to wrap
 * @param {string} id absolute path of the object
 */
function Properties(app, obj = {}, id = null) {
    obj[Properties.app] = app;
    obj[Properties.id] = id;
    for (key in obj) {
        if (obj[key] === null || obj[key] === undefined) continue;
        childId = Properties.getChilId(obj, key);
        if (obj[key][Properties.target])
            obj[key] = new Properties(app, obj[key][Properties.target], childId);
        else if (obj[key] instanceof Object)
            obj[key] = new Properties(app, obj[key], childId);
    }
    return new Proxy(obj, {
        set(obj, prop, value) {
            if ([Properties.target].includes(prop)) {
                throw new Error("Cannot set " + prop + " property");
            }
            let app = obj[Properties.app];
            let childId = Properties.getChilId(obj, prop);
            if (obj[prop] !== value || !(prop in obj)) {
                var updateLength = obj instanceof Array && prop.match(/^[0-9]+$/) && parseInt(prop) >= obj.length;
                obj[prop] = value === undefined || value === null ? value
                    : value[Properties.target] ? new Properties(app, value[Properties.target], childId)
                        : value instanceof Object ? new Properties(app, value, childId)
                            : value;
                if (updateLength) app.updateProp(Properties.getChilId(obj, "length"));
                app.updateProp(childId);
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
Properties.app = Symbol("app");
Properties.id = Symbol("id");

/**
 * Get child id
 * @param {Properties} properties
 * @param {string} key
 * @returns {string}
 */
Properties.getChilId = function (properties, key) {
    return properties[Properties.id] ? properties[Properties.id] + "." + key : key;
}

class App {
    /**
     * @param {HTMLElement} root the root element of the application
     * @param {Object} data initial data
     * @param {boolean} debugMode debug mode
     */
    constructor(root, data = {}, debugMode = false) {
        /**
         * Application data model
         * @type {Properties}
         */
        this.data = new Properties(this, data);
        /**
         * Debug mode
         * @type {boolean}
         */
        this.debugMode = debugMode;
        /**
         * Store which elements are updatable and with which data
         * @type {Object<string, HTMLElement>}
         */
        this.registry = {};
        /**
         * Store context by their associated HTML element
         * @type {Map<HTMLElement, Context>}
         */
        this.contexts = new Map();
        /**
         * The root element of the application
         * @type {HTMLElement}
         */
        this.root = root;
        this.onModelInput = this.onModelInput.bind(this);
        this.onEvent = this.onEvent.bind(this);
        this.update(this.root);
    }

    /**
     * Log a debug message or object
     * @param {...Object} object
     */
    debug(...object) {
        if (this.debugMode)
            console.log(...object);
    }

    /**
     * @param {HTMLElement} an HTML element
     * @returns {Context|Properties} the context of the element
     */
    getContext(el) {
        if (el == document.documentElement)
            return this.data;
        return this.contexts.get(el) || this.getContext(el.parentElement);
    }

    /**
     * Update some variables in local context
     * @param {HTMLElement} el HTML element to define the context
     * @param {Object} data variables to update
     * @param {Object<string, string>} equivalents equivalent variables names, for example { "user": "user.0" } for first element of a data-foreach-user="users"
     */
    updateContext(el, data, equivalents) {
        if (!this.contexts.has(el))
            this.contexts.set(el, new Context(this, el));
        for (let k in data)
            this.contexts.get(el)[Context.target][k] = data[k];
        for (let k in equivalents)
            this.contexts.get(el)[Context.equivalents][k] = equivalents[k];
    }

    /**
     * Add an element to the update registry
     * @param {HTMLElement} el HTML element to update
     * @param {string[]} updateNames properties which update the element
     */
    register(el, updateNames) {
        for (let updateName of updateNames) {
            if (!this.registry[updateName])
                this.registry[updateName] = new Set([el]);
            else
                this.registry[updateName].add(el);
        }
    }

    /**
     * Remove lost contexts and lost registry entries (of removed elements)
     */
    clean() {
        for (let el of this.contexts.keys())
            if (!document.contains(el))
                this.contexts.delete(el);
        for (let updateName in this.registry)
            for (let el of this.registry[updateName])
                if (!document.contains(el))
                    this.registry[updateName].delete(el);
    }

    /**
     * Evaluate a JavaScript expression in the context of an element
     * @param {string} js JavaScript expression
     * @param {HTMLElement} element HTML element to define the context
     * @param {Object} additionalContext additional viariables to pass to script
     * @returns {any} the result of the expression
     * @throws {Error} if an error occurs
     */
    evalExpression(js, element, additionalContext = {}) {
        return new Function("$context", "$additionalContext", "with ($context) with ($additionalContext) { return " + js + " }")
            .call(element, this.getContext(element), additionalContext);
    }

    /**
     * Check if an HTML should be ignored
     * @param {HTMLElement} el HTML element to check
     */
    isIgnored(el) {
        while (el.parentElement != this.root) {
            el = el.parentElement;
            if ("ignore" in el.dataset || !el.parentElement)
                return true;
        }
        return false;
    }

    /**
     * Update elements associated with a property
     * @param {string} prop property name
     */
    updateProp(prop) {
        this.debug("Update: " + prop);
        for (let el of this.registry[prop] || []) {
            if (!this.isIgnored(el)) {
                this.update(el, true);
            } else {
                this.debug("Ignore update element", el);
            }
        }
    }

    /**
     * Update HTML element and its children
     * @param {HTMLElement?} el HTML element to update
     */
    update(el = this.root, canTriggerSibling = false) {
        this.debug("Update element:", el, canTriggerSibling);
        var context = this.getContext(el);
        var updateChildren = true;

        // data-model
        if (el.dataset.model) {
            el.dataset.bind = el.dataset.model;
            var updateSet = new Set(el.dataset.update?.split("|") ?? []);
            updateSet.add(el.dataset.model)
            el.dataset.update = [...updateSet].join("|");
            el.removeEventListener("input", this.onModelInput);
            el.addEventListener("input", this.onModelInput);
        }

        // data-update : if updatable add it to update registry
        if (el.dataset.update) {
            this.register(el, context.findUpdatesName ? context.findUpdatesName(el.dataset.update) : el.dataset.update.split("|")); // TODO : tmp
        }

        // data-if attribute
        if (el.dataset.if) {
            let condition = this.evalExpression(el.dataset.if, el);
            App.showHide(el, condition, el.dataset.transition, el.dataset.transitionTime);
            if (canTriggerSibling) {
                for (let e = el.nextElementSibling; e?.dataset?.elif || e?.dataset?.else != undefined; e = e.nextElementSibling)
                    this.update(e);
            }
        }

        // data-elif attribute
        if (el.dataset.elif) {
            let ifElement = this.getIfElement(el);
            if (this.canTestElseValue(el)) {
                let condition = this.evalExpression(el.dataset.elif, el);
                App.showHide(el, condition, ifElement.transition, ifElement.transitionTime);
            } else {
                App.showHide(el, false, ifElement.transition, ifElement.transitionTime);
            }
            if (canTriggerSibling) {
                for (let e = el.previousElementSibling; e?.dataset?.if || e?.dataset?.elif; e = e.previousElementSibling)
                    this.update(e);
                for (let e = el.nextElementSibling; e?.dataset?.elif || e?.dataset?.else != undefined; e = e.nextElementSibling)
                    this.update(e);
            }
        }

        // data-else attribute
        else if (el.dataset.else != undefined) {
            let ifElement = this.getIfElement(el);
            App.showHide(el, this.canTestElseValue(el), ifElement.transition, ifElement.transitionTime);
            if (canTriggerSibling) {
                for (let e = el.previousElementSibling; e?.dataset?.if || e?.dataset?.elif; e = e.previousElementSibling)
                    this.update(e);
            }
        }

        // data-ignore attribute
        if ("ignore" in el.dataset)
            return;

        // data-with-* attribute
        for (let attr in el.dataset) {
            if (attr.startsWith("with")) {
                let varName = attr.replace("with", "").charAt(0).toLowerCase() + attr.replace("with", "").slice(1);
                let value = this.evalExpression(el.dataset[attr], el);
                this.updateContext(el, {
                    [varName]: value
                }, {
                    [varName]: value[Properties.id]
                });
            }
        }

        // data-bind attribute
        if (el.dataset.bind) {
            let value = this.evalExpression(el.dataset.bind, el);
            if ("INPUT" == el.tagName) {
                el[el.type == "checkbox" ? "checked" : "value"] = value;
            } else if (["TEXTAREA", "SELECT"].includes(el.tagName)) {
                el.value = value;
            } else if (el.innerText !== value)
                el.innerText = value;
        }

        // data-style attribute
        if (el.dataset.style) {
            let style = this.evalExpression(el.dataset.style, el);
            for (let prop in style)
                el.style[prop] = style[prop] ?? null;
        }

        for (let attr in el.dataset) {
            // data-on-* attributes
            if (attr.startsWith("on")) {
                //let eventName = App.camelToKebab(attr.replace("on", ""));
                let eventName = attr.replace("on", "").toLowerCase();
                el.removeEventListener(eventName, this.onEvent);
                el.addEventListener(eventName, this.onEvent);
            }

            // data-bind-* attributes
            if (attr.startsWith("bind") && attr != "bind") {
                let bindingAttr = App.camelToKebab(attr.replace("bind", ""));
                let value = this.evalExpression(el.dataset[attr], el);
                if (value === null || value === false || value === undefined)
                    el.removeAttribute(bindingAttr);
                else if (value === true)
                    el.setAttribute(bindingAttr, "");
                else
                    el.setAttribute(bindingAttr, value);
            }

            // data-foreach-* attribute
            if (attr.startsWith("foreach")) {
                let iVar = attr.replace("foreach", "").charAt(0).toLowerCase() + attr.replace("foreach", "").slice(1);
                // if first run
                if (el.dataset.content == undefined) {
                    el.dataset.content = el.innerHTML;
                    el.innerHTML = "";
                }
                let array = this.evalExpression(el.dataset[attr], el);
                if (!array || typeof array !== "object") {
                    console.error("`" + el.dataset[attr] + "` is not iterable nor an object", array);
                }
                let arrayEntries = Object.entries(array);
                let children = App.getChildren(el);
                let existingElements = {};
                exploreChildren: for (let child of children) {
                    let item = this.evalExpression(iVar, child);
                    for (let entry of arrayEntries) {
                        // same primative value or same reference
                        if (item?.[Properties.target] ? (item[Properties.target] === entry[1][Properties.target]) : (item === entry[1])) {
                            existingElements[entry[0]] = child;
                            continue exploreChildren;
                        }
                    }
                    // remove child
                    child.dataset.ignore = "";
                    App.leaveTransition(child, el.dataset.transition, el.dataset.transitionTime)
                        .then(() => child.remove());
                }
                for (let i = 0; i < arrayEntries.length; i++) {
                    let children = App.getChildren(el);
                    let entry = arrayEntries[i];
                    if (existingElements[entry[0]]) {
                        // updating existing elements
                        this.updateContext(children[i], {
                            [iVar]: entry[1],
                            [el.dataset.index]: entry[0],
                        }, {
                            [iVar]: entry[1][Properties.id]
                        });
                        this.update(children[i]);
                    } else {
                        // adding new elements
                        if (i == 0) el.insertAdjacentHTML("afterbegin", el.dataset.content);
                        else children[i - 1].insertAdjacentHTML("afterend", el.dataset.content);
                        let newChild = i == 0 ? el.firstElementChild : children[i - 1].nextElementSibling;
                        this.updateContext(newChild, {
                            [iVar]: entry[1],
                            [el.dataset.index]: entry[0]
                        }, {
                            [iVar]: entry[1][Properties.id]
                        });
                        this.update(newChild);
                        App.enterTransition(newChild, el.dataset.transition, el.dataset.transitionTime);
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
            let repeat = this.evalExpression(el.dataset.repeat, el);
            let last = App.getChildren(el).length;
            if (repeat > last) {
                // adding new elements
                for (let i = last; i < repeat; i++)
                    el.insertAdjacentHTML("beforeend", el.dataset.content);
                let children = App.getChildren(el);
                for (let i = last; i < repeat; i++) {
                    this.updateContext(children[i], {
                        [el.dataset.index]: i,
                    });
                    this.update(children[i]);
                    App.enterTransition(children[i], el.dataset.transition, el.dataset.transitionTime)
                }
            } else {
                // or removing excess elements
                let children = App.getChildren(el);
                for (let i = repeat; i < last; i++) {
                    children[i].dataset.ignore = "";
                    App.leaveTransition(children[i], el.dataset.transition, el.dataset.transitionTime)
                        .then(child => child.remove());
                }
            }
            updateChildren = false;
        }

        // data-html attribute
        if (el.dataset.html) {
            this.setInnerHTML(el, this.evalExpression(el.dataset.html, el));
        }

        // Update children
        if (updateChildren)
            for (let child of el.children)
                this.update(child);

        // data-include data-view attribute
        if (el.dataset.view) {
            fetch(el.dataset.view)
                .then(resp => resp.text())
                .then(html => {
                    this.setInnerHTML(el, html);
                    for (let child of el.children) {
                        this.update(child);
                    }
                });
        }

        this.clean();
    }

    /**
     * If data-elif or data-else should be tested
     * @param {HTMLElement} el HTML element with data-elif or data-else attribute
     */
    canTestElseValue(el) {
        let ifElement = el.previousElementSibling;
        if (ifElement) {
            if (ifElement.dataset.if)
                return !this.evalExpression(ifElement.dataset.if, ifElement);
            else if (ifElement.dataset.elif)
                return this.canTestElseValue(ifElement) && !this.evalExpression(ifElement.dataset.elif, ifElement);
        }
        console.warn("data-elif or data-else is not after a data-if or a data-elif, it was ignored", el);
        return true;
    }

    /**
     * Get data-if element
     * @param {HTMLElement} el HTML element with data-elif or data-else attribute
     */
    getIfElement(el) {
        let ifElement = el.previousElementSibling;
        if (ifElement) {
            if (ifElement.dataset.if)
                return ifElement;
            else if (ifElement.dataset.elif)
                return this.getIfElement(ifElement);
        }
        console.warn("data-elif or data-else is not after a data-if or a data-elif, it was ignored", el);
        return null;
    }

    /**
     * Set inner HTML of an element with scripts
     * @param {HTMLElement} el element to fill
     * @param {string} html HTML content
     */
    setInnerHTML(el, html) {
        el.innerHTML = html;
        this.clean();
        Array.from(el.querySelectorAll("script")).forEach(oldScript => {
            const newScript = document.createElement("script");
            Array.from(oldScript.attributes)
                .forEach(attr => newScript.setAttribute(attr.name, attr.value));
            newScript.appendChild(document.createTextNode(oldScript.innerHTML));
            oldScript.parentNode.replaceChild(newScript, oldScript);
        });
    }

    /**
     * Function called when an input event is triggered on a model element
     * @param {Event} event input event data
     */
    onModelInput(event) {
        this.evalExpression(event.currentTarget.dataset.model + " = this.type == 'checkbox' ? this.checked : ['INPUT','SELECT','TEXTAREA'].includes(this.tagName) ? this.value : this.innerText", event.currentTarget);
    }

    /**
     * Function called when an event is triggered
     * @param {Event} event event data
     */
    onEvent(event) { // TODO : add modifiers like .once, .prevent, .stop, .capture, .passive
        var expression = event.currentTarget.dataset["on" + event.type.charAt(0).toUpperCase() + event.type.slice(1)];
        this.evalExpression(expression, event.currentTarget, { $event: event });
    }

}

/**
 * Show or hide an element, can be animated with a transition
 * @param {HTMLElement} el element to show or hide
 * @param {boolean} showCondition true to show, false to hide
 * @param {string?} transition transition name
 * @param {number?} time transition time in milliseconds
 */
App.showHide = function (el, showCondition, transition = null, time = 500) {
    if (showCondition) {
        App.enterTransition(el, transition, time).then(() => el.style.display = "");
        delete el.dataset.ignore;
    } else {
        App.leaveTransition(el, transition, time).then(() => el.style.display = "none");
        el.dataset.ignore = "";
    }
}

/**
 * Remove element with transition
 * @param {HTMLElement} el HTML element to remove
 * @param {string?} transition transition name
 * @param {number?} [time=500] transition time in milliseconds
 * @returns {Promise<HTMLElement>}
 */
App.leaveTransition = function (el, transition = null, time = 500) {
    return new Promise(resolve => {
        if (transition === null) return resolve(el);
        if (transition == "") {
            el.style.transition = "opacity 0." + Math.round(time / 2) + "s";
            el.style.opacity = 0;
            setTimeout(() => resolve(el), time / 2);
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

/**
 * Add element with transition
 * @param {HTMLElement} el HTML element to add
 * @param {string?} transition transition name
 * @param {number?} [time=500] transition time in milliseconds
 * @returns {Promise<HTMLElement>}
 */
App.enterTransition = function (el, transition = null, time = 500) {
    return new Promise(resolve => {
        if (transition === null) return resolve(el);
        if (transition == "") {
            el.style.opacity = 0;
            el.style.transition = "opacity 0." + Math.round(time / 2) + "s";
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

/**
 * Get all children of an HTML element (excluding elements with data-ignore attribute)
 * @param {HTMLElement} el parent HTML element
 * @returns {HTMLElement[]}
 */
App.getChildren = function (el) {
    return Array.from(el.children).filter(child => !("ignore" in child.dataset));
}

/**
 * Convert a camelCase string to a kebab-case string
 * @param {string} str camelCase string
 * @returns {string}
 */
App.camelToKebab = function (str) {
    return str.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

if (document.documentElement.dataset.app) {
    var js = document.documentElement.dataset.app;
    var data = new Function("return " + js).call(document.documentElement);
    var debugMode = "debug" in document.documentElement.dataset;
    this.app = new App(document.documentElement, data, debugMode=debugMode);
    window.addEventListener("load", () => this.app.update());
}
