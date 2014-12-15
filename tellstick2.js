/*************************
  SARAH-Plugin-tellstick2
  Author: Alban Vidal-Naquet
  Date: 13/12/2013
  Description:
    tellstick2 Plugin for SARAH project (see http://encausse.wordpress.com/s-a-r-a-h/)
	
**************************/

/*****************************
  TODO LIST:
    -
******************************/
const cs_atmospherefile="atmosphere.txt"
const cs_groupfile="group.txt"
const cs_aliasfile="alias.txt"
const cs_tellstick2xmlfile="tellstick2.xml";
const cs_logfile="dailytask.txt";

// For prowl notification
const cs_log_prowl=1;

var g_debug=6;
var loc=require("./customloc.js").init(__dirname);
var bf=require("./basicfunctions.js").init(function(){return g_debug;});

var g_listdevice;
var g_listgroup;
var g_listatmosphere;
var g_cmd="";
var g_lastplace="";
var g_lastlevel=125;
var g_atmospheremode="";
var g_lastatmosphere;

var g_stack=new Array();

function DeformatDailyTask(d, str, SARAH)
{
  bf.debugF(4, "\n\n");
  bf.debugF(4, "DeformatDailyTask: "+str);
  var dailytask=str.split(";");
  for (var i=0;i<dailytask.length;i++)
  {
     var segment=dailytask[i].split("=");
	 var days=segment[0].split(",");
	 if (days.indexOf(""+d.getDay())!=-1)
	 {
		var re=new RegExp("(\\d{2})(\\d{2})([+]?[\\d]*)*-(\\d{2})(\\d{2})([+]?[\\d]*)*");
		var res=re.exec(segment[1]);
		var b=new Date();
		var e=new Date();
		if (typeof res[3]==="undefined") res[3]=0;
		if (typeof res[6]==="undefined") res[6]=0;
		// begin time action
		var info={day:segment[0], bh:parseInt(res[1]), bm:parseInt(res[2]), bd:parseInt(res[3]), eh:parseInt(res[4]), em:parseInt(res[5]), ed:parseInt(res[6]), mode:segment[2]};
		b.setHours(info.bh);
		b.setMinutes(info.bm);
		b.setSeconds(0);
		if (d.getTime()<b.getTime() || d.getTime()<(b.getTime()+info.bd))
		{
			g_stack.push({date: b, diff: parseInt(res[3]), mode: segment[2], ope: "b", task: dailytask[i], armed: 0});
			bf.debugF(4, "adding task: "+JSON.stringify({date: b, diff: parseInt(res[3]), mode: segment[2], ope: "b", task: dailytask[i], armed: 0}));
		}
		// end time action
		e.setHours(info.eh);
		e.setMinutes(info.em);
		e.setSeconds(0);
		if (e.getTime()<b.getTime()) e.setTime(e.getTime()+(24*60*60*1000));
		if (d.getTime()<e.getTime() || d.getTime()<(e.getTime()+info.ed))
		{
			g_stack.push({date: e, diff: parseInt(res[6]), mode: segment[2], ope: "e", task: dailytask[i], armed: 0});
			bf.debugF(4, "adding task: "+ JSON.stringify({date: e, diff: parseInt(res[6]), mode: segment[2], ope: "e", task: dailytask[i], armed: 0}));
		}
	 }
  }
}

function setTaskTimeout(d, info, SARAH)
{
	var r=info.date;
	var min=0;
	if (info.diff>0)
		min=Math.floor(Math.random()*10*info.diff)%info.diff;
	r.setTime(r.getTime()+(min*60*1000));
    if (r.getTime()>=d.getTime())
    {
        var hdl=setTimeout(function()
				{
					var data={silent:1};
					var todo=info.mode.split(",");
					var i=0;
					
                    if (SARAH.context.tellstick_timeout.indexOf(info.hdl)==-1)
                    {
                        bf.debugF(4, "Obsolete task: " + JSON.stringify(info));
                        return 0;
                    }
					for (i=0;i<todo.length;i++)
					{
						var comment="";

						if (todo[i]=="")
							continue;
						if (todo[i].trim().indexOf("#")==0)
						{
							data.ambiance=todo[i].trim().substring(1);
							switch(info.ope)
							{
								case "b":
									comment="power on atmosphere '"+data.ambiance+"'";
									data.mode="ambiance";
									break;
								case "e":
									comment="power off atmosphere '"+data.ambiance+"'";
									data.mode="off";
									data.level=0;
									break;
							}
						}
						else
						{
							var re=new RegExp(/([^(]*)\(([0-9]*)\)/);
							var res=re.exec(todo[i]);
							if (res.length>0)
							{
								var level=res[2];
								data.mode="tamise";
								data.place=res[1];
								switch(info.ope)
								{
									case "b":
										data.level=Math.floor(res[2]*2.56);
										comment="power on '"+data.place+"' at level "+res[2];
										break;
									case "e":
										data.level=0;
										comment="power off '"+data.place+"'";
										break;
								}
							}
							else
								console.log("***tellstick2: error in task, unknow format '"+todo[i]+"'");
						}
						bf.debugF(4, "running task: " + info.task + "(" + info.ope + ")");
						bf.log(cs_logfile, "dailytask: "+comment);
                        if (cs_log_prowl==1)
                            bf.sendProwl(SARAH, "User1", "tellstick2", "dailytask: "+comment);
                        data.task=1;
						action(data,function(){},SARAH.ConfigManager.getConfig(),SARAH);
						var index=SARAH.context.tellstick_timeout.indexOf(info.hdl);
						if (index!=-1)
							SARAH.context.tellstick_timeout.splice(index, 1);
                        // Delete task in list
                        for (var j in g_stack)
                            if (g_stack[j].hdl==info.hdl)
                            {
                                g_stack.slice(j,1);
                                break;
                            }
					}
				},
				(r.getTime()-d.getTime()));
        info.hdl=hdl;
        SARAH.context.tellstick_timeout.push(hdl);
        bf.debugF(4, "SetTimeout to: " + r + " " + Math.floor((r.getTime()-d.getTime())/60000) + " for task " + info.task + "(" + info.ope + ")");
        return 0;
    }
    return -1;
}

function setDailyConfig(SARAH)
{
	bf.debugF(4, "setDailyConfig");
	var d=new Date();
	// For debug
	//d.setHours(0);
	//d.setMinutes(0);
	// end debug
	var config=SARAH.ConfigManager.getConfig();
	config=config.modules.tellstick2;
    for (var i in config)
    {
        if (i.search("auto")==0)
            if (config[i]!="")
                DeformatDailyTask(d, config[i], SARAH);
    }
	bf.debugF(8, g_stack);
	// Now set timeout for each task
	for (var i=0;i<g_stack.length;)
    {
        // If already armed then skip current task
        if (g_stack[i].armed==1)
            i++;
		else
            if (setTaskTimeout(d, g_stack[i], SARAH)!=0)    
                // Task is in the past, so delete it
                g_stack.slice(i,1);
            else
                g_stack[i++].armed=1;
    }
	// Set timeout to the next day...
	var d=new Date();
	var e=new Date();
	e.setTime(e.getTime()+24*60*60*1000);
	e.setHours(0);
	e.setMinutes(0);
	e.setSeconds(1);
	var wait=e.getTime()-d.getTime();
	bf.debugF(4,"Next daily check is in " + (wait)/1000 + " seconds");
	setTimeout(function(){setDailyConfig(SARAH);}, wait);
}

exports.init = function(SARAH)
{
	bf.debugF(4, "Init");
	var config=SARAH.ConfigManager.getConfig();
	var xml1="	<one-of>\n";
	var xml2="\t<one-of>\n";
	
    if (typeof(SARAH.context.tellstick_timeout)!="undefined")
        // Clear old timer
        for (var i in SARAH.context.tellstick_timeout)
        {
          bf.debugF(4, "Canceling task: "+SARAH.context.tellstick_timeout[i]);
          clearTimeout(SARAH.context.tellstick_timeout[i]);
        }
	SARAH.context.tellstick_timeout=new Array();
	g_stack=new Array();
	config=config.modules.tellstick2;
	g_cmd="\""+config.tdtool+"\"";
	bf.exec(g_cmd+" --list", 
			function(arg1, arg2, err, stdout, stderr)
			{
				var ar=stdout.split("\n");
				var i=0;
				var j=0;
				var k=0;
				g_listdevice=new Array();
				g_listgroup=new Array();
				g_listatmosphere=new Array();
				for (i=1;i<ar.length;i++)
				{
					if (ar[i].trim()=="")
						continue;
					var segment=ar[i].split("\t");
					bf.debugF(1, "Adding device '"+segment[1]+"'");
					g_listdevice[segment[1]]=segment[0];
					xml1+="		<item>"+segment[1]+"<tag>out.action.place=\""+segment[1]+"\";</tag></item>\n";
				}
				var fs   = require('fs');
				var txt  = fs.readFileSync(__dirname+"\\"+cs_groupfile,'utf8');
				var listgroup=txt.split("\n");
				for (i=0;i<listgroup.length;i++)
				{
                    if (listgroup[i].search("#")==0)
                        continue;
					var segment=listgroup[i].split("=");
					if (listgroup[i]=="")
						continue;
					if (segment[0] in g_listdevice)
					{
						console.log("***tellstick2: group '"+segment[0]+"' already exist as device, skipping it");
						continue;
					}
					bf.debugF(1, "Adding group '"+segment[0]+"'");
					g_listgroup[segment[0]]=new Array();
					var listdev=segment[1].split(",");
					for (j=0;j<listdev.length;j++)
					{
						var name=listdev[j].trim();
						if (name in g_listdevice)
						{
							bf.debugF(1, "  Adding in group '"+segment[0] + "' the device '"+name+"' ("+g_listdevice[name]+")");
							g_listgroup[segment[0]].push(g_listdevice[name]);
						}
						else
						{
							if (name in g_listgroup)
							{
								bf.debugF(1, "  Adding in group '"+segment[0] + "' the group '"+name+"'");
								for (k=0;k<g_listgroup[name].length;k++)
									g_listgroup[segment[0]].push(g_listgroup[name][k]);
							}
							else
								console.log("***tellstick2: can not found device or group '"+ cs_groupfile+":"+name+"'");
						}
					}
					xml1+="		<item>"+segment[0]+"<tag>out.action.place=\""+segment[0]+"\";</tag></listgroup>\n";
				}
				var txt  = fs.readFileSync(__dirname+"\\"+cs_atmospherefile,'utf8');
				var listambiance=txt.split("\n");
				for (i=0;i<listambiance.length;i++)
				{
                    if (listambiance[i].search("#")==0)
                        continue;
					var segment=listambiance[i].split("=");
					if (listambiance[i]=="")
						continue;
					bf.debugF(1, "Adding atmosphere '"+segment[0]+"'");
					g_listatmosphere[segment[0]]=new Array();
					var listdev=segment[1].split(",");
					for (j=0;j<listdev.length;j++)
					{
						var re;
						re=new RegExp(/\(([0-9]*)\)/);
						var level=re.exec(listdev[j]);
						re=new RegExp(/^[^\(]*/);
						var name=re.exec(listdev[j]);
						if (name.length==0 || level.length==0)
							console.log("***tellstick2: Malformated ambiance: '"+listdev[j]+"'");
						else
						{
							if (name in g_listdevice)
							{
								bf.debugF(1, "  Adding in atmosphere '"+segment[0] + "' the device '"+name+"' ("+g_listdevice[name]+")");
								g_listatmosphere[segment[0]].push(g_listdevice[name]+":"+Math.floor(level[1]*2.56));
							}
							else
							{
								if (name in g_listgroup)
								{
									bf.debugF(1, "  Adding in atmosphere '"+segment[0] + "' the group '"+name+"'");
									for (k=0;k<g_listgroup[name].length;k++)
										g_listatmosphere[segment[0]].push(g_listgroup[name][k]+":"+Math.floor(level[1]*2.56));
								}
								else
									console.log("***tellstick2: can not found device or group '"+ cs_atmospherefile+":"+name+"'");
							}
						}
					}
					xml2+="\t\t<item>"+segment[0]+"<tag>out.action.ambiance=\""+segment[0]+"\";</tag></item>\n";
				}
				var txt  = fs.readFileSync(__dirname+"\\"+cs_aliasfile,'utf8');
				var listalias=txt.split("\n");
				for (i=0;i<listalias.length;i++)
				{
                    if (listalias[i].search("#")==0)
                        continue;
					var segment=listalias[i].split("=");
					if (listalias[i]=="")
						continue;
					if (segment[0] in g_listdevice || segment[0] in g_listgroup)
					{
						var sublistalias=segment[1].split(",");
						for (j=0;j<sublistalias.length;j++)
						{
							var name=sublistalias[j].trim();
							if (name in g_listdevice)
							{
								console.log("***tellstick2: alias '"+name+"' already exist as device, skipping it");
								continue;
							}
							if (name in g_listgroup)
							{
								console.log("***tellstick2: alias '"+name+"' already exist as group, skipping it");
								continue;
							}
							bf.debugF(1, "Adding alias '"+name+"' for '"+segment[0]+"'");
							xml1+="		<item>"+name+"<tag>out.action.place=\""+segment[0]+"\";</tag></item>\n";
						}
					}
					else
						console.log("***tellstick2: can not found device or group '"+segment[0]+"'");					
				}
				xml1+="	</one-of>\n	";
				xml2+="\t</one-of>\n\t";
				var file=__dirname+"\\"+cs_tellstick2xmlfile;
				bf.replaceSectionInFile(file, file, "1", xml1);
				bf.replaceSectionInFile(file, file, "2", xml2);
			}
			,0,0);
	setDailyConfig(SARAH);
}

			 
exports.release = function(SARAH)
{
    if (typeof(SARAH.context.tellstick_timeout)!="undefined")
        // Clear old timer
        for (var i in SARAH.context.tellstick_timeout)
        {
          bf.debugF(4, "Canceling task: "+SARAH.context.tellstick_timeout[i]);
          clearTimeout(SARAH.context.tellstick_timeout[i]);
        }
   loc.release();
}

var action = function(data, callback, config, SARAH)
{
	var config=config.modules.tellstick2;
	var i=0;
	var place="";
	
    bf.debugF(2, "Action received");
	bf.debugF(2, data);
    if (typeof(data.task)=="undefined")
        data.task=0;
	if (typeof(data.mode)!="undefined" && data.mode!="" && (typeof data.silent==="undefined" || data.silent==0))
		SARAH.speak(loc.getLocalString("OKLETSGO"));
	if (data.place=="" || typeof data.place==="undefined")
		place=g_lastplace;
	else
	{
		g_atmospheremode=false;
		place=data.place;
	}
	switch(data.mode)
	{
		case "ambiance":
			if (data.ambiance in g_listatmosphere)
			{
				var arg=""
				g_lastatmosphere=new Array();
				for (i=0;i<g_listatmosphere[data.ambiance].length;i++)
				{
					var c=g_listatmosphere[data.ambiance][i];
					var dev=c.substring(0, c.indexOf(":"));
					var level=0;
					
					if (typeof data.level!=="undefined" && data.level==0)
						level=0;
					else
						level=parseInt(c.substring(c.indexOf(":")+1));
					if (level<0)   level=0;
					if (level>255) level=255;
					arg=buildArg(level);
					tdtool(g_cmd+arg+dev, SARAH, dev, data.task);
					g_lastatmosphere.push({'dev':dev,'lev':level});
				}
				g_atmospheremode=true;
			}
			break;
		case "on":
			runTdTool(SARAH, place, 255, 255, data.task);
			break;
		case "off":
			runTdTool(SARAH, place, 0, 0, data.task);
			break;
		case "tamise":
			runTdTool(SARAH, place, data.level, 0, data.task);
			break;
		case "moins":
			g_lastlevel=runTdTool(SARAH, place, g_lastlevel, 10, data.task);
			break;
		case "plus":
			g_lastlevel=runTdTool(SARAH, place, g_lastlevel, -10, data.task);
			break;
		case "moinsmoins":
			g_lastlevel=runTdTool(SARAH, place, g_lastlevel, +20, data.task);
			break;
		case "plusplus":
			g_lastlevel=runTdTool(SARAH, place, g_lastlevel, -20, data.task);
			break;
		default:
			break;
	}
	if (typeof data.place!=="undefined" && data.place!="")
	{
		g_atmospheremode=false;
		g_lastplace=data.place;
	}
	if (typeof data.level!=="undefined")
		g_lastlevel=data.level;
	callback();
	return 0;
}

exports.action=action;

var buildArg=function(level)
{
	switch(level)
	{
		case 0:   return " --off ";                      break;
		case 255: return " --on ";                       break;
		default:  return " --dimlevel "+level+" --dim "; break;
	}
	return "";
}

function tdtool(cmd, SARAH, device, istask)
{
	bf.debugF(2, "tdtool: " + cmd);
	bf.exec(cmd, 
			function(SARAH,arg2,err,stdout,stderr)
			{
				if (err!=null) 
				{
					console.log("***tellstick2:tdtool("+cmd+") return '"+err+"': "+stdout+", "+stderr);
                    if (istask==1)
                        bf.log(cs_logfile, "dailytask: error on "+cmd+", return "+err+": "+stdout+", "+stderr);
                    if (cs_log_prowl==1)
                        bf.sendProwl(SARAH, "User1", "tellstick2", "dailytask: error on "+cmd+", return "+err+": "+stdout+", "+stderr);
                    else
                    {
                        loc.addDictEntry("DEVICE", device);
                        SARAH.speak(loc.getLocalString("TDTOOLERROR"));
                    }
				}
			},
			SARAH,0);
}

var runTdTool=function(SARAH, place, levelstr, delta, istask)
{
	var arg="";
    var level=levelstr;
    if (typeof(levelstr)=="string")
        level=parseInt(levelstr);
	if (g_atmospheremode==true && typeof delta!=="undefined")
	{
		for (i=0;i<g_lastatmosphere.length;i++)
		{
			var level;
			if (delta==0 || delta==255)
			  level=delta;
			else
			  level=g_lastatmosphere[i].lev+delta;
			if (level<0)   level=0;
			if (level>255) level=255;
			arg=buildArg(level);
			tdtool(g_cmd+arg+g_lastatmosphere[i].dev, SARAH, g_lastatmosphere[i].dev, istask);
			g_lastatmosphere[i].lev=level;
		}
	}
	else
	{
		if (typeof delta!="undefined")
			level+=delta;
		if (typeof place!=="undefined")
		{
			if (level<0)   level=0;
			if (level>255) level=255;
			arg=buildArg(level);
			if (place in g_listdevice)
				tdtool(g_cmd+arg+g_listdevice[place], SARAH, g_listdevice[place], istask);
			else if (place in g_listgroup)
				for (var i=0;i<g_listgroup[place].length;i++)
					tdtool(g_cmd+arg+g_listgroup[place][i], SARAH, g_listgroup[place][i], istask);
			else
				console.log("***tellstick2: can not found place '"+place+"'");
		}
		else
			console.log("***tellstick2: no place defined or unknown");
	}
	return level;
}




