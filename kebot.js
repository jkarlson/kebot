var msgre = /:(\S+) PRIVMSG (\S+) :(.+)/i
var joinre = /:(\S+) JOIN :(\S+)/i
var cmdre = /%(\S+)( +\S.+)?/i
var pingre = /^PING( .+)/i
var saytoken = /(\S+) (.*)/
var hostmaskre = /([^!@ ]+)!([^!@ ]+)@([^!@ ]+)/
var timerre = /KEBOTCMD TIMER (\S+) +(.+)/
var numericre = /\S+ ([0-9]+) \S+ .*/
var nickre = /:(\S+) NICK :(\S+)/

var lines = x.split("\n")

/*
 * Auxiliary functions.
 */

function join(channel) {
	return "JOIN " + channel + "\n"
}
function op(channel, user) {
	return "MODE " + channel + " +o " + user + "\n"
}
function privmsg(whom, what) {
	return "PRIVMSG "+whom+" :"+what+"\n"
}
function nick(newnick){
	return "NICK " + newnick + "\n"
}

function escapesqls(s) {
	return s.replace(/'/g,"''")
}
function setDBValue() {
	var input = "PRAGMA SQLITE_TEMP_STORE=3; replace into '" + arguments[0] + "' values('"
	var init_i = 1
	var is_volatile = true
	var inputs = new Array(arguments.length - init_i)

	for (i=init_i;i<arguments.length;i++) {
		inputs[i-init_i]=escapesqls(arguments[i])
	}
	input += inputs.join("','")

	input += "');"
	return cppGetDBValue(input, is_volatile);
}
function getDBValue() {
	var input = "PRAGMA SQLITE_TEMP_STORE=3; select data from '" + arguments[0] + "' where "
	var init_i = 1
	var is_volatile = false
	if (typeof(arguments[1]) == "boolean") {
		is_volatile = arguments[1]
		init_i = 2
	}
	var inputs = new Array(arguments.length - init_i)

	for (i=init_i; i < arguments.length; i++) {
		var key = " key == "
		var thisarg=arguments[i]
		if (Array.isArray(thisarg)) {
			if (thisarg.length > 2) {
				var thisarray = new Array(thisarg.length-1)
				for (j=1;j<thisarg.length;j++) {
					thisarray[j-1]=escapesqls(thisarg[j])
				}
				inputs[i-init_i] = "" + thisarg[0] + " IN ('" + thisarray.join("','") + "')"
			}
			else {
				inputs[i-init_i] = "" + thisarg[0] + " == '" + escapesqls(thisarg[1]) + "'"
			}
		}
		else {
			inputs[i-init_i] = "key == '" + escapesqls(thisarg) + "'"
		}
	}
	input += inputs.join(" AND ")
	input += ";"
	return cppGetDBValue(input, is_volatile);
}

/*
 * Command handling code
 */
var commands = {}
var privCommands = {}

function addCommand(f, h) {
	var retval = new Object
	retval.help = h
	retval.func = f
	return retval
}

function timerCmd(parameters, who, hostmask, context) {
	var timers = / *([0-9]{1,5}) +(.*)/.exec(parameters)
	var message
	var time

	if (timers) {
		time=timers[1]*60
		message=timers[2]
	}
	else {
		timers = / *(?:([0-9]{1,3})h)?(?:([0-9]{1,5})m)?(?:([0-9]{1,6})s)? *(.*)/.exec(parameters)
		if (timers && (timers[1] || timers[2] || timers[3])) {
			time = 0
			message=timers[4]
			for (i=1;4>i;i++) {
				time*=60
				if (timers[i])
					time+=parseInt(timers[i])
			}
		}
	}

	if (time && message) {
		cppSetTimer(time, "KEBOTCMD TIMER "+context+" " + who + ": " + message + "\n")
		return privmsg(context, "Timer set for " + time + " seconds\n")
	}
	else
		return privmsg(context, "No parse, or time longer than 200h!")
}
function helpCmd(parameters, who, hostmask, context) {
	var cmd = parameters.trim()
	if (commands[cmd])
		return privmsg(context, commands[cmd].help)
	if (privCommands[cmd])
		return privmsg(context, privCommands[cmd].help)

	var cmds = new Array
	var i = 0
	for (var prop in commands)
		cmds[i++]=prop
	for (var prop in privCommands)
		cmds[i++]=prop

	return  privmsg(context, "Available commands: " + cmds.join(" "))
}
function sayCmd(parameters, who, hostmask, context) {
	var targets = saytoken.exec(parameters)
	if (targets)
		return privmsg(targets[1],targets[2])
}
function joinCmd(parameters, who, hostmask, context) {
	return join(parameters)
}
function reloadCmd(parameters, who, hostmask, context) {
	exit("RELOAD")
}
function dieCmd(parameters, who, hostmask, context) {
	exit("EXIT")
}
function nickCmd(parameters, who, hostmask, context) {
	return nick(parameters)
}
commands["timer"]         =addCommand(timerCmd,"timer [<hours>h][<minutes>[m]][<seconds>s] <message>, send a <message> to me in this context\n")
commands["help"]          =addCommand(helpCmd,"help <cmd>, print help for <cmd>; help, list all commands\n")
privCommands["say"]       =addCommand(sayCmd,"say <whom> <what>, send a message <what> to <whom>\n")
privCommands["join"]      =addCommand(joinCmd,"join <#channel>, join channel\n")
privCommands["reload"]    =addCommand(reloadCmd,"Reload client script\n")
privCommands["die"]       =addCommand(dieCmd,"Exit IRC session permanently\n")
privCommands["nick"]      =addCommand(nickCmd,"nick <newnick>, change nick to newnick\n")

function cmdevent(command, parameters, who, context){
	if (typeof(parameters) == "undefined")
		parameters = ""
	var hostmask = hostmaskre.exec(who)
	if (!hostmask)
		return ""

	if (commands[command])
		return commands[command].func(parameters, hostmask[1], hostmask, context)

	if (getDBValue("master", ["ident", hostmask[2]], ["host"].concat(getHosts(hostmask[3]))) != 'yes')
		return ""

	if (privCommands[command])
		return privCommands[command].func(parameters, hostmask[1], hostmask, context)

	return "";
}

function msgevent(who,whom,message){
	var cmd = cmdre.exec(message)
	if (cmd) {
		if (/^[#!]/.exec(whom))
			return cmdevent(cmd[1],cmd[2],who,whom)
		else
			return cmdevent(cmd[1],cmd[2],who,who)
	}
	return ""
}

function getHosts(host) {
	var hosts = host.split('.')

	var table = new Array(hosts.length)
	for (i=0;i<hosts.length;i++) {
		table[i]=hosts.slice(i).join(".")
	}

	return table
}

function nickevent(who, newnick) {
	var hostmask = hostmaskre.exec(who)
	if (hostmask) {
		if (getDBValue("state", true, "nick") == hostmask[1]) {
			setDBValue("state", "nick", newnick)
			log("Nick changed to " + getDBValue("state", true, "nick"))
			return ""
		}
	}
	return ""
}

function myjoinevent(where) {
	return getDBValue("joinaction",where)
}
function joinevent(who, where) {
	var hostmask = hostmaskre.exec(who)
	if (hostmask) {
		if (getDBValue("op."+where, ["ident", hostmask[2]], ["host"].concat(getHosts(hostmask[3]))) == "yes") {
			return op(where,hostmask[1])
		}
		var mynick = getDBValue("state",true,"nick")
		if (hostmask[1] == mynick) {
			return myjoinevent(where)
		}
	}
	return ""
}

function connectevent() {
	var channels = getDBValue("conf", "channels").split(" ")
	var retval = ""
	for (i in channels)
		retval += join(channels[i])
	setDBValue("state", "connected", "yes")
	return retval
}

function numericevent(number) {
	switch (Number(number)) {
	case 1:
		return connectevent()
	case 433:
		if ("yes" != getDBValue("state", true, "connected")) {
			var mynick = getDBValue("conf", "altnick")
			setDBValue("state", "nick", mynick)
			return nick(mynick)
		}
		return ""

	}
	return ""
}

function f(b){
	var retval=''
	for (i in b) {
		var msg = msgre.exec(b[i])
		if (msg) {
			retval += msgevent(msg[1],msg[2],msg[3])
			continue
		}
		var ping = pingre.exec(b[i])
		if (ping) {
			retval += 'PONG' + ping[1] + '\n'
			continue
		}
		var join = joinre.exec(b[i])
		if (join) {
			retval += joinevent(join[1],join[2].toLowerCase())
			continue
		}
		var timer = timerre.exec(b[i])
		if (timer) {
			retval += "PRIVMSG " + timer[1] + " :" + timer[2] + "\n"
			script_retval = false
			continue
		}
		var nickchg = nickre.exec(b[i])
		if (nickchg) {
			retval += nickevent(nickchg[1], nickchg[2])
			continue
		}
		if ("TIMEOUTSOON" == b[i]) {
			retval += privmsg(getDBValue("state", true, "nick"), "ping")
			continue
		}
		if ("INIT" == b[i]) {
			var mynick = getDBValue("conf", "nick")
			cppGetDBValue("create table state (key TEXT, data TEXT, unique(key));", true);
			setDBValue("state","nick", mynick)
			retval += "USER " + getDBValue("conf", "ident") + " * * :" + getDBValue("conf","realname") + "\n"
			retval += nick(mynick)
			continue
		}
		var numeric = numericre.exec(b[i])
		if (numeric) {
			retval += numericevent(numeric[1])
			continue
		}
	}
	return retval
}

f(lines)

