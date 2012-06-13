tortoise = (function (undefined) {
    /* PUBLIC INTERFACE */

    var eval = function (string, env) {
        return evalTortoise(tortoiseParser.parse(string), env);
    };

    var evalTortoise = function (stmts, env) {
        env = setupEnv(env);

        var tmp = evalFull(evalStatements, stmts, env);

        return isArray(tmp) && tmp[0] === breaker ? tmp[1] : tmp;
    };

	var compileTortoise = function (stmts, env) {
		var script = new ScriptBuilder();
		var lookup = { bindings: { }, outer: null };

		script.beginBlock('(function () {');
		env = setupEnv(env);
		compileEnvironment(env, lookup, script);
		compileStatements(stmts, script, lookup, true);
		script.endBlock('})');

		return script.toString();
	};
	
    var addBindingConst = function (v, val) {
        if (v in builtinFunctions) throw('Symbol already defined: ' + v);
        return builtinFunctions[v] = '' + val;
    };

    var addBindingVar = function (v, val) {
        if (v in builtinFunctions) throw('Symbol already defined: ' + v);
        return builtinFunctions[v] = val;
    };

    var addBindingFunc = function (v, val, nParams) {
        if (v in builtinFunctions) throw('Symbol already defined: ' + v);
        return builtinFunctions[v] = {
            func: val,
            nArgs: +nParams,
            thunked: false
        };
    };

    // Built-in functions

    var builtinFunctions = { };

    addBindingFunc('alert', typeof alert == 'undefined' ? function (x) { console.log(x); } : function (x) { window.alert(x); }, 1);

    addBindingConst('PI', Math.PI);
    addBindingConst('E', Math.E);

    addBindingFunc('sin', function (a) { return Math.sin(a * Math.PI / 180); }, 1);
    addBindingFunc('cos', function (a) { return Math.cos(a * Math.PI / 180); }, 1);
    addBindingFunc('tan', function (a) { return Math.tan(a * Math.PI / 180); }, 1);
    addBindingFunc('asin', function (n) { return Math.asin(n) / Math.PI * 180; }, 1);
    addBindingFunc('acos', function (n) { return Math.acos(n) / Math.PI * 180; }, 1);
    addBindingFunc('atan', function (n) { return Math.atan(n) / Math.PI * 180; }, 1);
    addBindingFunc('atan2', function (x, y) { return Math.atan2(x, y) / Math.PI * 180; }, 2);

    addBindingFunc('abs', function (a) { return Math.abs(a); }, 1);
    addBindingFunc('ceil', function (a) { return Math.ceil(a); }, 1);
    addBindingFunc('floor', function (a) { return Math.floor(a); }, 1);
    addBindingFunc('round', function (a) { return Math.round(a); }, 1);
    addBindingFunc('log', function (a) { return Math.log(a); }, 1);
    addBindingFunc('exp', function (a) { return Math.exp(a); }, 1);
    addBindingFunc('sqrt', function (a) { return Math.sqrt(a); }, 1);
    addBindingFunc('pow', function (a, b) { return Math.pow(a, b); }, 2);
    addBindingFunc('min', function (a, b) { return Math.min(a, b); }, 2);
    addBindingFunc('max', function (a, b) { return Math.max(a, b); }, 2);

    /* HELPERS */

    var isArray = function (obj) {
        return obj && obj instanceof Array;
    };

	var sanitizeId = (function (/* id */) {
		var reservedWords = /^(abstract|as|boolean|break|byte|case|catch|char|class|continue|console|const|debugger|default|delete|do|double|else|enum|export|extends|false|final|finally|float|for|function|goto|if|implements|import|in|instanceof|int|interface|is|jQuery|long|Math|myTurtle|namespace|native|new|null|package|private|protected|public|return|short|static|super|switch|synchronized|this|throw|throws|transient|true|try|typeof|use|var|void|volatile|while|window|with)$/;

		return function (id) {
			return reservedWords.test(id) ? '$' + id : id;
		};
	})();
	
	var setupEnv = function (env) {
        if (env && !env.bindings) env = { bindings: env };
        if (!env) env = { bindings: { } };
        env.outer = {
            bindings: builtinFunctions
        };
		return env;
	};

    var lookupBinding = function (env, v) {
        if (!env) throw('Symbol not defined: ' + v);
        if (v in env.bindings) {
            var tmp = env.bindings[v];

            return typeof tmp === 'object' ? tmp : +tmp;
        }
        return lookupBinding(env.outer, v);
    };

    var lookupBindingNoFail = function (env, v) {
        if (!env) return null;
        if (v in env.bindings) {
            var tmp = env.bindings[v];

            return typeof tmp === 'object' ? tmp : +tmp;
        }
        return lookupBindingNoFail(env.outer, v);
    };

    var lookupBindingNoFailLocal = function (env, v) {
        if (env && v in env.bindings) {
            var tmp = env.bindings[v];

            return typeof tmp === 'object' ? tmp : +tmp;
        }
        return null;
    };

    var updateBinding = function (env, v, val) {
        if (!env) throw('Symbol not defined: ' + v);
        if (v in env.bindings) {
            if (typeof env.bindings[v] !== typeof val) throw('Cannot update symbol: ' + v);
            return env.bindings[v] = val;
        }
        return updateBinding(env.outer, v, val);
    };

    var addBinding = function (env, v, val) {
        if (v in env.bindings) throw('Symbol already defined: ' + v);
        return env.bindings[v] = val;
    };
	
    /* INTERPRETER */

    var breaker = {};
    var thkVal = {};
    var thkThunk = {};
    var arraySlice = Array.prototype.slice;
    var undefinedBodyThunk = { tag: 'ignore', body: { tag: 'undef' } };

    var thunk = function () {
        var args = arraySlice.call(arguments);
        var f = args.shift();

        return [thkThunk, f, args];
    };

    var thunkValue = function (x) {
        return [thkVal, x];
    };

    var stepStart = function (f, expr, env) {
        return [f.call(null, expr, env, thunkValue, function (x) { throw('Unhandled exception: ' + x); }), false];
    };

    var stepStartExt = function (stmts, env) {
        if (env && !env.bindings) env = { bindings: env };
        if (!env) env = { bindings: {} }
        env.outer = {
            bindings: builtinFunctions
        };

        return stepStart(evalStatements, stmts, env);
    };

    var step = function (state) {
        var thk = state[0];

        if (thk[0] === thkThunk) {
            return !(state[0] = thk[1].apply(null, thk[2]));
        }
        else if (thk[0] === thkVal) {
            state[0] = thk[1];
            return state[1] = true;
        }
        else {
            throw('Bad thunk');
        }
    };

    var stepEnd = function (state) {
        return state[1] && state[0] || null;
    };

    var evalFull = function (f, expr, env) {
        var thk = stepStart(f, expr, env)[0];

        while (thk[0] === thkThunk) thk = thk[1].apply(null, thk[2]);
        if (thk[0] === thkVal) return thk[1];
        throw('Bad thunk');
    };

    var doUnaryOp = function (expr, env, cont, xcont, op) {
        return thunk(evalExpr, expr, env, function (v) {
            var tmp = op(cont, xcont, v);

            return thunk(tmp[0], tmp[1]);
        }, xcont);
    };

    var doBinaryOp = function (exprLeft, exprRight, env, cont, xcont, op) {
        return thunk(evalExpr, exprLeft, env, function (x) {
            return thunk(evalExpr, exprRight, env, function (y) {
                var tmp = op(cont, xcont, x, y);

                return thunk(tmp[0], tmp[1]);
            }, xcont);
        }, xcont);
    };

    var doTernaryOp = function (exprLeft, exprMid, exprRight, env, cont, xcont, op1, op2) {
        return thunk(evalExpr, exprMid, env, function (y) {
            return thunk(evalExpr, exprLeft, env, function (x) {
                var tmp1 = op1(cont, xcont, x, y);

                return tmp1[0] === xcont ? thunk(xcont, tmp1[1]) : !x ? thunk(cont, x) : thunk(evalExpr, exprRight, env, function (z) {
                    var tmp2 = op2(cont, xcont, y, z);

                    return thunk(tmp2[0], tmp2[1]);
                }, xcont);
            }, xcont);
        }, xcont);
    };

    var ops = {
        // Unary operators
        '!' : function (c, e, v) { return [c, v === 0 ? 1 : 0]; },
        'neg': function (c, e, v) { return [c, -v]; },

        // Binary operators
        '+': function (c, e, x, y) { return [c, +x + y]; },
        '-': function (c, e, x, y) { return [c, x - y]; },
        '*': function (c, e, x, y) { return [c, x * y]; },
        '/': function (c, e, x, y) {
            if (y === 0) return [e, 'Division by zero'];
            return [c, x / y];
        },
        '%': function (c, e, x, y) {
            if (y === 0) return [e, 'Division by zero'];
            return [c, x % y];
        },
        '**': function (c, e, x, y) { return [c, y === 0 ? 1 : x && Math.pow(x, y)]; },
        '==': function (c, e, x, y) { return [c, x === y ? 1 : 0]; },
        '!=': function (c, e, x, y) { return [c, x !== y ? 1 : 0]; },
        '<': function (c, e, x, y) { return [c, x < y ? 1 : 0]; },
        '>': function (c, e, x, y) { return [c, x > y ? 1 : 0]; },
        '<=': function (c, e, x, y) { return [c, x <= y ? 1 : 0]; },
        '>=': function (c, e, x, y) { return [c, x >= y ? 1 : 0]; }
    };

    var evalStatements = function (stmts, env, cont, xcont) {
        var len = stmts.length;
        var idx = -1;

        var stmtEvalCont = function (r) {
            if (isArray(r) && r[0] === breaker) return thunk(cont, r);
            return ++idx < len ? thunk(evalStatement, stmts[idx], env, stmtEvalCont, xcont)
                : thunk(cont, r);
        };

        return stmtEvalCont(undefined);
    };

    var evalStatement = function (stmt, env, cont, xcont) {
        switch (stmt.tag) {
            // A single expression
            case 'ignore':
                return thunk(evalExpr, stmt.body, env, cont, xcont);

            // Variable declaration
            case 'var':
                return thunk(evalExpr, stmt.body || 0, env, function (v) {
                    addBinding(env, stmt.name, v);
                    return thunk(cont, v);
                }, xcont)

            // Const declaration
            case 'const':
                return thunk(evalExpr, stmt.body || 0, env, function (v) {
                    v = '' + v;
                    addBinding(env, stmt.name, v);
                    return thunk(cont, v);
                }, xcont)

            // Function declaration
            case 'define':
                addBinding(env, stmt.name, {
                    func: function (cont, xcont) {
                        var newEnv = {
                            outer: env,
                            bindings: { }
                        };
                        var result;
                        var args = stmt.args;

                        for (var i = 0; i < args.length; ++i) newEnv.bindings[args[i]] = arguments[i + 2];
                        return thunk(evalStatements, stmt.body, newEnv, function (r) {
                            return thunk(cont, isArray(r) && r[0] === breaker ? r[1] : r);
                        }, xcont);
                    },
                    nArgs: stmt.args.length,
                    thunked: true
                });
                return thunk(cont, undefined);

            // Assignment
            case ':=':
                return thunk(evalExpr, stmt.right, env, function (v) {
                    updateBinding(env, stmt.left, v);
                    return thunk(cont, v);
                }, xcont)

            // If/Else
            case 'if':
                return thunk(evalExpr, stmt.expr, env, function (c) {
                    return thunk(evalStatements, c && stmt.body || stmt.body2 || undefinedBodyThunk, env, cont, xcont);
                }, xcont);

            // Repeat
            case 'repeat':
                return thunk(evalExpr, stmt.expr, env, function (n) {
                    if (n > 0) {
                        var loopCont = function (r) {
                            return n-- > 0 ? thunk(evalStatements, stmt.body, env, loopCont, xcont) : thunk(cont, r);
                        };

                        return loopCont(undefined);
                    }
                    else {
                        return thunk(cont, undefined);
                    }
                });

            // While
            case 'while':
                var ret = undefined;
                var whileCont = function () {
                    return thunk(evalExpr, stmt.expr, env, function (c) {
                        return c ? thunk(evalStatements, stmt.body, env, function (r) {
                            ret = r;
                            return whileCont();
                        }, xcont) : thunk(cont, ret);
                    }, xcont);
                };

                return whileCont();

            // Return
            case 'return':
                return thunk(evalExpr, stmt.expr, env, function (v) {
                    return thunk(cont, [breaker, v]);
                }, xcont);

            // Try/Catch
            case 'try':
                return thunk(evalStatements, stmt.body, env, cont, function (ex) {
                    return thunk(evalStatements, stmt.body2, env, cont, xcont);
                });
        }
    };

    var evalExpr = function (expr, env, cont, xcont) {
        // Numbers evaluate to themselves
        if (typeof expr === 'number') return thunk(cont, expr);

        var tmp, tag;

        switch (tag = expr.tag) {
            // Special

            case 'undef':
                return thunk(cont, undefined);

            case 'throw':
                return thunk(xcont, 'User exception');

            case 'ident':
                tmp = lookupBinding(env, expr.name);
                if (typeof tmp === 'object') throw('Variable expected: ' + expr.name);
                return thunk(cont, +tmp);

            case 'call':
                var tmp2 = [];
                var len = expr.args.length;
                var idx = -1;

                tmp = lookupBinding(env, expr.name);
                if (typeof tmp !== 'object') throw('Function expected: ' + expr.name);
                if (len !== tmp.nArgs && tmp.nArgs >= 0) throw('Function \'' + expr.name + '\' needs exactly ' + tmp.nArgs + ' arguments');

                var funcEvalCont = function (r) {
                    if (idx >= 0) tmp2[idx] = r;
                    ++idx;
                    return idx < len ? thunk(evalExpr, expr.args[idx], env, funcEvalCont, xcont)
                        : tmp.thunked ? (tmp2.unshift(xcont), tmp2.unshift(cont), tmp.func.apply(null, tmp2))
                        : thunk(cont, tmp.func.apply(null, tmp2));
                };

                return funcEvalCont(undefined);

            // Unary operators

            case '!':
            case 'neg':
                return doUnaryOp(expr.arg, env, cont, xcont, ops[tag]);

            // Binary operators

            case '+':
            case '-':
            case '*':
            case '/':
            case '%':
            case '**':
            case '==':
            case '!=':
            case '<':
            case '>':
            case '<=':
            case '>=':
                return doBinaryOp(expr.left, expr.right, env, cont, xcont, ops[tag]);

            case '&&':
                return thunk(evalExpr, expr.left, env, function (x) {
                    return !x ? thunk(cont, x) : thunk(evalExpr, expr.right, env, function (y) {
                        return thunk(cont, y);
                    }, xcont);
                }, xcont);

            case '||':
                return thunk(evalExpr, expr.left, env, function (x) {
                    return x ? thunk(cont, x) : thunk(evalExpr, expr.right, env, function (y) {
                        return thunk(cont, y);
                    }, xcont);
                }, xcont);

            // Ternary operators

            case '? :':
                return thunk(evalExpr, expr.left, env, function (x) {
                    return x ? thunk(evalExpr, expr.middle, env, function (y) {
                        return thunk(cont, y);
                    }, xcont) : thunk(evalExpr, expr.right, env, function (z) {
                        return thunk(cont, z);
                    }, xcont);
                }, xcont);

            case '< <':
            case '< <=':
            case '<= <':
            case '<= <=':
            case '> >':
            case '> >=':
            case '>= >':
            case '>= >=':
                tmp = tag.split(' ');
                return doTernaryOp(expr.left, expr.middle, expr.right, env, cont, xcont, ops[tmp[0]], ops[tmp[1]]);

            default:
                throw('Unknown operator: \'' + tag + '\'');
        }
    };

	/* COMPILER */

	var tmpVar = (function () {
		var idx = 0;
	
		return function () {
			return '$$' + idx++;
		};
	})();
	

	var SymbolTypes = {
		VAR: 1,
		CONST: 2,
		NATIVE_FUNCTION: 3,
		FUNCTION: 4
	};
	
    var compileStatements = function (stmts, script, lookup, inFunction) {
		var len = stmts.length;
		
		if (inFunction) script.appendLine('var $res;')
		for (var i = 0; i < len; ++i) {
			compileStatement(stmts[i], lookup, script);
		}
		if (inFunction) script.appendLine('return $res;')
    };

    var compileStatement = function (stmt, lookup, script) {
		var tmp;

        switch (stmt.tag) {
            // A single expression
            case 'ignore':
				script.appendBeginLine('$res = ');
				compileExpr(stmt.body, lookup, script);
				script.appendEndLine(';');
				break;

            // Variable declaration
            case 'var':
				if ((tmp = lookupBindingNoFailLocal(lookup, stmt.name)) === null || tmp < 0) {
					(tmp < 0 ? updateBinding : addBinding)(lookup, stmt.name, SymbolTypes.VAR);
					script.appendBeginLine(tmp < 0 ? '' : 'var ').append(sanitizeId(stmt.name)).append(' = $res = ');
					compileExpr(stmt.body || 0, lookup, script);
					script.appendEndLine(';');
				}
				else {
					script.appendLine('throw("Symbol already defined: ' + stmt.name + '");');
				}
				break;

            // Const declaration
            case 'const':
				if ((tmp = lookupBindingNoFailLocal(lookup, stmt.name)) === null || tmp < 0) {
					(tmp < 0 ? updateBinding : addBinding)(lookup, stmt.name, SymbolTypes.CONST);
					script.appendBeginLine(tmp < 0 ? '' : 'var ').append(sanitizeId(stmt.name)).append(' = $res = ');
					compileExpr(stmt.body || 0, lookup, script);
					script.appendEndLine(';');
				}
				else {
					script.appendLine('throw("Symbol already defined: ' + stmt.name + '");');
				}
				break;

            // Function declaration
            case 'define':
				if ((tmp = lookupBindingNoFailLocal(lookup, stmt.name)) === null || tmp < 0) {
					(tmp < 0 ? updateBinding : addBinding)(lookup, stmt.name, SymbolTypes.FUNCTION + stmt.args.length);
					script.pushState().appendBeginLine(tmp < 0 ? '' : 'var ').append(sanitizeId(stmt.name)).append(' = function(');
					lookup = { bindings: { }, outer: lookup };
					for (var i = 0; i < stmt.args.length; ++i) {
						var arg = stmt.args[i];
					
						if (lookupBindingNoFailLocal(lookup, arg) === null) {
							if (i) script.append(', ');
							script.append(sanitizeId(arg));
							addBinding(lookup, arg, SymbolTypes.VAR);
						}
						else {
							lookup = arg;
							break;
						}
					}
					if (typeof lookup == 'string') {
						script.popState().appendLine('throw("Symbol already defined: ' + lookup + '");');
					}
					else {
						script.dropState().beginInlineBlock(') {');
						compileStatements(stmt.body, script, lookup, true);
						script.endBlock('};').appendLine('$res = $.undefined;');
					}
				}
				else {
					script.appendLine('throw("Symbol already defined: ' + stmt.name + '");');
				}
				break;

            // Assignment
            case ':=':
				if ((tmp = lookupBindingNoFail(lookup, stmt.left)) === null) {
					script.appendLine('throw("Symbol not defined: ' + stmt.left + '");');
				}
				else if (tmp !== SymbolTypes.VAR) {
					script.appendLine('throw("Cannot update symbol: ' + stmt.left + '");');
				}
				else {
					script.appendBeginLine('$res = ').append(sanitizeId(stmt.left)).append(' = ');
					compileExpr(stmt.right, lookup, script);
					script.appendEndLine(';');
				}
				break;

            // If/Else
            case 'if':
				script.appendBeginLine('if (');
				compileExpr(stmt.expr, lookup, script);
				script.beginInlineBlock(') {');
				compileStatements(stmt.body, script, lookup, false);
				script.endBlock('}');
				if (stmt.body2) {
					script.beginBlock('else {');
					compileStatements(stmt.body2, script, lookup, false);
					script.endBlock('}');
				}
				break;

            // Repeat
            case 'repeat':
				tmp = tmpVar();
				script.appendBeginLine('var ').append(tmp).append(' = ');
				compileExpr(stmt.expr, lookup, script);
				script.appendEndLine(';').appendBeginLine('while (').append(tmp).appendBeginInlineBlock('--) {');
				compileStatements(stmt.body, script, lookup, false);
				script.endBlock('}');
				break;

            // While
            case 'while':
				script.appendBeginLine('while (');
				compileExpr(stmt.expr, lookup, script);
				script.beginInlineBlock(') {')
				compileStatements(stmt.body, script, lookup, false);
				script.endBlock('}');
				break;

            // Return
            case 'return':
				script.appendBeginLine('return ');
				compileExpr(stmt.expr, lookup, script);
				script.appendEndLine(';');
				break;

            // Try/Catch
            case 'try':
				script.beginBlock('try {');
				compileStatements(stmt.body, script, lookup, false);
				script.endBlock('}').beginBlock('catch ($ex) {');
				compileStatements(stmt.body2, script, lookup, false);
				script.endBlock('}');
				break;
        }
    };

    var compileExpr = function (expr, lookup, script) {
        // Numbers evaluate to themselves
        if (typeof expr === 'number') {
			script.append(expr.valueOf());
			return;
		};

		var tag, tmp;
		
        switch (tag = expr.tag) {
            // Special

            case 'undef':
                script.append('$.undefined');
				break;

            case 'throw':
                script.append('$.throw()');
				break;

            case 'ident':
				if ((tmp = lookupBindingNoFail(lookup, expr.name)) === null) {
					script.append('$.throw("Symbol not defined: ' + expr.name + '")');
				}
				else if ((tmp = Math.abs(tmp)) >= SymbolTypes.NATIVE_FUNCTION) {
					script.append('$.throw("Variable or constant expected: ' + expr.name + '")');
				}
				else {
					script.append(sanitizeId(expr.name));
				}
				break;

            case 'call':
				if ((tmp = lookupBindingNoFail(lookup, expr.name)) === null) {
					script.append('$.throw("Symbol not defined: ' + expr.name + '");');
				}
				else if ((tmp = Math.abs(tmp)) < SymbolTypes.NATIVE_FUNCTION) {
					script.append('$.throw("Function expected: ' + expr.name + '")');
				}
				else {
					var len = expr.args.length;

					if (tmp === SymbolTypes.NATIVE_FUNCTION || len + SymbolTypes.FUNCTION === tmp) {
						script.append(sanitizeId(expr.name)).append('(');
						for (var i = 0; i < len; ++i) {
							if (i > 0) script.append(', ');
							compileExpr(expr.args[i], lookup, script);
						}
						script.append(')');
					}
					else {
						script.append('$.throw("Function \'' + expr.name + '\' needs exactly ' +  (tmp - SymbolTypes.FUNCTION) +' arguments")');
					}
				}
				break;

            // Unary operators

            case '!':
                script.append('(');
				compileExpr(expr.arg, lookup, script);
                script.append(' ? 0 : 1)');
				break;

			case 'neg':
                script.append('-(');
				compileExpr(expr.arg, lookup, script);
                script.append(')');
				break;

            // Binary operators

            case '+':
            case '-':
            case '*':
            case '/':
            case '%':
            case '==':
            case '!=':
            case '<':
            case '>':
            case '<=':
            case '>=':
            case '&&':
            case '||':
                script.append('(');
				compileExpr(expr.left, lookup, script);
                script.append(' ').append(tag).append(' ');
				compileExpr(expr.right, lookup, script);
                script.append(')');
				break;

			case '**':
                script.append('$.pow(');
				compileExpr(expr.left, lookup, script);
                script.append(', ');
				compileExpr(expr.right, lookup, script);
                script.append(')');
				break;

            // Ternary operators

            case '? :':
                script.append('(');
				compileExpr(expr.left, lookup, script);
                script.append(' ? ');
				compileExpr(expr.middle, lookup, script);
                script.append(' : ');
				compileExpr(expr.right, lookup, script);
                script.append(')');
				break;

            case '< <':
            case '< <=':
            case '<= <':
            case '<= <=':
            case '> >':
            case '> >=':
            case '>= >':
            case '>= >=':
                var fn = tmp = tag.replace(' ', '_').replace('<', 'lt').replace('>', 'gt').replace('=', 'e');
				
                script.append('$.').append(fn).append('(');
				compileExpr(expr.left, lookup, script);
                script.append(', ');
				compileExpr(expr.middle, lookup, script);
                script.append(', ');
				compileExpr(expr.right, lookup, script);
                script.append(')');
				break;

            default:
                throw('Unknown operator: \'' + tag + '\'');
        }
    };
	
	var compileEnvironment = function (env, lookup, script) {
		for (var p in env.bindings) {
			var v = env.bindings[p];

			if (lookupBindingNoFail(lookup, p) !== null) continue;
			switch (typeof v) {
				case 'string':
					v = +v;
					addBinding(lookup, p, -(SymbolTypes.CONST));
					break;
					
				case 'boolean':
					v = v ? 1 : 0;
				case 'number':
					addBinding(lookup, p, -SymbolTypes.VAR);
					break;
					
				case 'object':
					if (typeof v.func != 'function') continue;
					addBinding(lookup, p, -(SymbolTypes.FUNCTION + v.nArgs));
					v = v.func;
					break;
					
				case 'function':
					addBinding(lookup, p, -SymbolTypes.NATIVE_FUNCTION);
					break;
			}
			script.appendBeginLine('var ').append(sanitizeId(p)).append(' = ').append(v).appendEndLine(';');
		}
		if (env.outer) {
			compileEnvironment(env.outer, lookup, script);
		}
		else {
			script.beginBlock('var $ = {');
			script.appendLine('"undefined": [][0],');
			script.appendLine('"throw": function (msg) { throw(msg || "User exception"); },');
			script.appendLine('"pow": Math.pow,');
			script.appendLine('"lt_lt": function (l, m, r) { return l < m && m < r; },');
			script.appendLine('"lt_lte": function (l, m, r) { return l < m && m <= r; },');
			script.appendLine('"lte_lt": function (l, m, r) { return l <= m && m < r; },');
			script.appendLine('"lte_lte": function (l, m, r) { return l <= m && m <= r; },');
			script.appendLine('"gt_gt": function (l, m, r) { return l > m && m > r; },');
			script.appendLine('"gt_gte": function (l, m, r) { return l > m && m >= r; },');
			script.appendLine('"gte_gt": function (l, m, r) { return l >= m && m > r; },');
			script.appendLine('"gte_gte": function (l, m, r) { return l >= m && m >= r; }');
			script.endBlock('};');
		}
	};
	
    var ScriptBuilder = function (initialScript) {
        var script = isArray(initialScript) ? initialScript : initialScript ? [initialScript] : [];
        var p = 0;
		var stateStack = [];
        var ind = 0;

        var that = {
            indentation: '    ',
            debug: true,

            indent: function () {
                ++ind;
                return that;
            },

            dedent: function () {
                if (--ind < 0) throw('ScriptBuilder.dedent(), ind < 0');
                return that;
            },

            append: function (text) {
                if ('' + text !== '') script[p++] = text;
                return that;
            },

            appendBeginLine: function (text) {
                if (that.debug && i) {
                    var x = ind;
                    var i = that.indentation;
                    
                    while (x--) that.append(i);
                }
                return that.append(text);
            },

            appendEndLine: function (text) {
                that.append(text);
                if (that.debug) that.append('\n');
                return that;
            },

            appendLine: function (line) {
                return that.appendBeginLine(line).appendEndLine();
            },

            appendComment: function (comment) {
				if (that.debug) that.appendLine('/* ' + comment + ' */');
                return that;
            },

            beginBlock: function (block) {
                return that.appendLine(block || '{').indent();
            },

            endBlock: function (block) {
                return that.dedent().appendLine(block || '}');
            },

            beginInlineBlock: function (block) {
                return that.appendEndLine(block || '{').indent();
            },

            endInlineBlock: function (block) {
                return that.dedent().appendBeginLine(block || '}');
            },

			pushState: function () {
				stateStack.push({ p: p, ind: ind, debug: that.debug });
				return that;
			},

			popState: function () {
                if (stateStack.length === 0) throw('ScriptBuilder.popState(), stateStack.length === 0');

				var s = stateStack.pop();
				
				p = s.p;
				ind = s.ind;
				that.debug = s.debug;
				return that;
			},

			dropState: function () {
                if (stateStack.length === 0) throw('ScriptBuilder.dropState(), stateStack.length === 0');
				stateStack.pop();
				return that;
			},
			
            toString: function () {
				if (p < script.length) script = script.slice(0, p);
                return script.join('');
            }
        };

        return that;
    };

    return {
        eval: eval,
        evalTortoise: evalTortoise,
		compileTortoise: compileTortoise,
        stepStart: stepStartExt,
        step: step,
        stepEnd: stepEnd,
		compile: compileTortoise,
        addBindingConst: addBindingConst,
        addBindingVar: addBindingVar,
        addBindingFunc: addBindingFunc
    };
})();