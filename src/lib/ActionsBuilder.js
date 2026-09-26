/**
 * ActionsBuilder — every control a person could use on the page right now.
 *
 * One DOM walk lists each visible, enabled, reachable element someone could type
 * into, choose or click: native controls, ARIA widgets, and elements with no role
 * that are focusable, have a click handler or a pointer cursor (suggestion items,
 * cards) — inside open shadow roots and visible iframes too. Each comes with its
 * label, current value, where it sits (dialog, landmark, heading path), the
 * snapshot `ref` when it has one (so `click/type/select --ref` work) and a
 * `selector` (plus `within` for iframes) that always addresses it exactly.
 *
 * Elements are tagged with data-aux4-el="<id>"; ids are renumbered on every call.
 */

function collectActions(args){
  var START=args.start||1, INCLUDE_NAV=!!args.includeNav, WITH_PAGE=!!args.withPage, IS_FRAME=!!args.isFrame;
  var norm=function(s){ return String(s==null?"":s).replace(/\s+/g," ").trim(); };
  var txt=function(e){ return e ? norm(e.innerText||e.textContent) : ""; };
  var vw=window.innerWidth||1280, vh=window.innerHeight||720;
  function parentEl(e){ if(!e) return null; if(e.parentElement) return e.parentElement; var r=e.getRootNode&&e.getRootNode(); return r&&r.host?r.host:null; }
  function vis(e){
    var r=e.getBoundingClientRect(); if(r.width<1||r.height<1) return false;
    var s=getComputedStyle(e); return s.visibility!=="hidden"&&s.display!=="none"&&parseFloat(s.opacity||"1")>0.02;
  }
  function inside(anc,e){ for(var x=e;x;x=parentEl(x)){ if(x===anc) return true; } return false; }
  var all=[]; var SKIP={SCRIPT:1,STYLE:1,NOSCRIPT:1,TEMPLATE:1,HEAD:1,META:1,LINK:1};
  (function walk(root){
    var els=root.querySelectorAll("*");
    for(var i=0;i<els.length;i++){
      var el=els[i]; if(el.hasAttribute("data-aux4-el")) el.removeAttribute("data-aux4-el");
      if(SKIP[el.tagName]) continue;
      all.push(el); if(el.shadowRoot) walk(el.shadowRoot);
    }
  })(document);
  // snapshot refs: the same walk and numbering as the snapshot command
  var refOf=new Map();
  if(!IS_FRAME){
    var IR=["button","link","textbox","checkbox","radio","combobox","listbox","menuitem","tab","switch","searchbox","slider","spinbutton","option"];
    var CR=["table","form","list","navigation","menu","dialog","tablist","tree"];
    var implicitRole=function(el){
      var tag=el.tagName.toLowerCase();
      if(tag==="a") return el.hasAttribute("href")?"link":null;
      if(tag==="button") return "button";
      if(tag==="input"){ var t=(el.getAttribute("type")||"text").toLowerCase(); if(t==="checkbox") return "checkbox"; if(t==="radio") return "radio"; if(t==="submit"||t==="button"||t==="reset") return "button"; if(t==="range") return "slider"; if(t==="number") return "spinbutton"; if(t==="search") return "searchbox"; return "textbox"; }
      if(tag==="textarea") return "textbox"; if(tag==="select") return "combobox"; if(tag==="nav") return "navigation"; if(tag==="table") return "table"; if(tag==="form") return "form";
      if(tag==="ul"||tag==="ol") return "list"; if(tag==="li") return "listitem"; if(tag==="dialog") return "dialog"; if(tag==="option") return "option";
      return null;
    };
    var snapVis=function(el){ var r=el.getBoundingClientRect(); if(r.width===0||r.height===0) return false; var s=getComputedStyle(el); return !(s.visibility==="hidden"||s.display==="none"||s.opacity==="0"); };
    var n=0; var every=[]; (function walk(root){ root.querySelectorAll("*").forEach(function(el){ every.push(el); if(el.shadowRoot) walk(el.shadowRoot); }); })(document);
    for(var ri=0;ri<every.length;ri++){ var rel=every[ri]; var rr=rel.getAttribute("role")||implicitRole(rel); if(!rr||(IR.indexOf(rr)<0&&CR.indexOf(rr)<0)) continue; if(!snapVis(rel)) continue; n++; refOf.set(rel,n); }
  }
  var dialogs=all.filter(function(e){ var r=(e.getAttribute("role")||"").toLowerCase(); return ((e.tagName==="DIALOG"&&e.open)||r==="dialog"||r==="alertdialog"||e.getAttribute("aria-modal")==="true")&&vis(e); });
  var dialog=dialogs.length?dialogs[dialogs.length-1]:null;
  function nameOf(e){
    if(!e) return "";
    var a=e.getAttribute("aria-label"); if(a&&a.trim()) return norm(a);
    var lb=e.getAttribute("aria-labelledby");
    if(lb){ var root=e.getRootNode(); var t=lb.split(/\s+/).map(function(id){ var n=(root&&root.getElementById&&root.getElementById(id))||document.getElementById(id); return txt(n); }).join(" "); if(norm(t)) return norm(t); }
    return "";
  }
  var dialogName=dialog?(nameOf(dialog)||txt(dialog.querySelector("h1,h2,h3,h4,[role=heading]")).slice(0,80)):"";
  var INTER="a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=option],[role=menuitem],[role=tab],[role=checkbox],[role=radio],[role=switch],[role=combobox],[role=textbox],[role=searchbox],[role=treeitem]";
  function closestInteractive(e){ for(var x=parentEl(e);x&&x.nodeType===1;x=parentEl(x)){ if(x.matches&&x.matches(INTER)) return x; } return null; }
  function kindOf(e){
    var tag=e.tagName, role=(e.getAttribute("role")||"").toLowerCase();
    if(tag==="INPUT"){
      var t=(e.getAttribute("type")||"text").toLowerCase();
      if(t==="hidden"||t==="file"||t==="range"||t==="color") return null;
      if(t==="checkbox") return role==="switch"?"switch":"checkbox";
      if(t==="radio") return "radio";
      if(t==="submit"||t==="button"||t==="reset"||t==="image") return "button";
      if(e.readOnly) return "button"; // a read-only box that opens a picker
      if(role==="combobox") return "combobox";
      if(t==="search") return "searchbox";
      return "textbox";
    }
    if(tag==="TEXTAREA") return "textbox";
    if(tag==="SELECT") return "select";
    if(role){
      if(role==="combobox") return "combobox";
      if(role==="textbox"||role==="searchbox") return role;
      if(role==="switch") return "switch";
      if(role==="checkbox"||role==="menuitemcheckbox") return "checkbox";
      if(role==="radio"||role==="menuitemradio") return "radio";
      if(role==="option"||role==="treeitem") return "option";
      if(role==="menuitem") return "menuitem";
      if(role==="tab") return "tab";
      if(role==="button") return "button";
      if(role==="link") return "link";
    }
    if(tag==="A"&&e.hasAttribute("href")) return "link";
    if(tag==="BUTTON"||tag==="SUMMARY") return "button";
    if(e.isContentEditable&&!(parentEl(e)&&parentEl(e).isContentEditable)) return "textbox";
    if(tag==="HTML"||tag==="BODY"||tag==="LABEL"&&e.control) return null;
    if(e instanceof SVGElement&&e.tagName.toLowerCase()!=="svg") return null;
    var clickable=e.hasAttribute("onclick");
    var ti=e.getAttribute("tabindex"); if(ti!==null&&parseInt(ti,10)>=0&&!role) clickable=true;
    if(!clickable){
      var cs=getComputedStyle(e); if(cs.cursor!=="pointer") return null;
      var p=parentEl(e); if(p&&p.nodeType===1&&getComputedStyle(p).cursor==="pointer") return null;
    }
    if(closestInteractive(e)) return null;
    return "card";
  }
  function labelOf(e,kind){
    var n=nameOf(e); if(n) return n;
    var tag=e.tagName;
    if(kind==="textbox"||kind==="searchbox"||kind==="combobox"&&(tag==="INPUT")||kind==="select"||kind==="checkbox"||kind==="radio"||kind==="switch"){
      if(e.labels&&e.labels.length){ var l=txt(e.labels[0]); if(l) return l; }
      var pl=e.closest&&e.closest("label"); if(pl&&txt(pl)) return txt(pl);
      var ph=e.getAttribute("placeholder"); if(ph) return norm(ph);
      if(kind!=="select"&&kind!=="textbox"&&kind!=="searchbox"&&txt(e)) return txt(e);
      return norm(e.getAttribute("title")||e.getAttribute("name")||e.id||"");
    }
    if(tag==="INPUT"){ if(e.readOnly){ var rl=(e.labels&&e.labels[0]&&txt(e.labels[0]))||e.getAttribute("placeholder")||e.getAttribute("title"); if(rl) return norm(rl); } return norm(e.value||e.getAttribute("title")||""); }
    var t=txt(e); if(t) return t;
    var img=e.querySelector&&e.querySelector("img[alt]"); if(img) return norm(img.getAttribute("alt"));
    return norm(e.getAttribute("title")||"");
  }
  var HEAD="h1,h2,h3,h4,h5,h6,[role=heading],legend";
  function levelOf(h){ var m=/^H([1-6])$/.exec(h.tagName); if(m) return +m[1]; if(h.tagName==="LEGEND") return 7; return parseInt(h.getAttribute("aria-level"),10)||2; }
  function contextOf(e){
    var region="", regionName="", heading="", depth=0, stop=false, path=[], minLevel=99;
    for(var x=parentEl(e);x&&x.nodeType===1;x=parentEl(x),depth++){
      var r=(x.getAttribute("role")||"").toLowerCase(), tg=x.tagName;
      if(!heading&&!stop&&depth<12&&x.querySelector){
        var hs=x.querySelectorAll(HEAD);
        for(var i=hs.length-1;i>=0;i--){ var h=hs[i]; if(inside(h,e)) continue; var hc=h.closest("a[href],button,[tabindex],[role=button],[role=option],[role=link],[role=tab]"); if(hc&&!inside(hc,e)) continue; if(h.compareDocumentPosition(e)&4){ if(vis(h)){ heading=txt(h).slice(0,70); minLevel=levelOf(h); path=[heading]; } break; } }
      }
      if(!stop&&depth<12&&x.querySelector&&heading&&path.length<3){
        var hs2=x.querySelectorAll(HEAD);
        for(var i2=hs2.length-1;i2>=0;i2--){ var h2=hs2[i2]; if(inside(h2,e)) continue; if(!(h2.compareDocumentPosition(e)&4)) continue; var lv=levelOf(h2); if(lv>=minLevel) continue; var t2=txt(h2).slice(0,70); if(t2&&vis(h2)){ if(path.indexOf(t2)<0) path.unshift(t2); minLevel=lv; } break; }
      }
      if(!region){
        if(x===dialog||r==="dialog"||r==="alertdialog"||tg==="DIALOG"){ region="dialog"; regionName=nameOf(x)||dialogName; }
        else if(r==="listbox"||r==="menu"||r==="tree"||r==="grid"){ region="list"; regionName=nameOf(x); }
      }
      if(!region||region==="list"){
        var land="";
        if(tg==="HEADER"||r==="banner") land="header"; else if(tg==="NAV"||r==="navigation") land="nav"; else if(tg==="FOOTER"||r==="contentinfo") land="footer"; else if(tg==="ASIDE"||r==="complementary") land="aside"; else if(tg==="FORM"||r==="form"||r==="search") land="form"; else if(tg==="MAIN"||r==="main") land="main";
        if(land&&!region){ region=land; regionName=nameOf(x); }
        else if(land&&region==="list"&&(land==="header"||land==="nav"||land==="footer")){ region=land; }
      }
      if(region&&region!=="list"){ stop=true; if(heading) break; }
    }
    var c=region?(region+(regionName?(" \""+regionName.slice(0,50)+"\""):"")):"";
    if(heading&&heading!==regionName) c=c?(c+" > "+heading):heading;
    if(heading&&path.indexOf(heading)<0) path.push(heading);
    return {context:c, region:region||"page", regionName:regionName, heading:heading, headingPath:path};
  }
  function disabled(e){
    if(e.disabled) return true;
    for(var x=e;x&&x.nodeType===1;x=parentEl(x)){ if(x.getAttribute("aria-disabled")==="true"||x.hasAttribute("inert")) return true; if(x.tagName==="FIELDSET"&&x.disabled) return true; }
    return false;
  }
  function reachable(e){
    var r=e.getBoundingClientRect();
    var inView=r.bottom>0&&r.right>0&&r.top<vh&&r.left<vw;
    if(!inView) return dialog?inside(dialog,e):true;
    var root=e.getRootNode&&e.getRootNode(); if(!root||!root.elementFromPoint) root=document;
    var ys=[r.top+r.height/2], xs=[r.left+r.width/2, r.left+Math.min(4,r.width/2), r.right-Math.min(4,r.width/2)];
    for(var i=0;i<xs.length;i++){
      var x=Math.min(Math.max(xs[i],0),vw-1), y=Math.min(Math.max(ys[0],0),vh-1);
      var hit=root.elementFromPoint(x,y);
      if(!hit) continue;
      if(hit===e||inside(e,hit)) return true;
      if(e.labels){ for(var j=0;j<e.labels.length;j++){ if(inside(e.labels[j],hit)) return true; } }
    }
    return false;
  }
  var items=[], id=START, seen=[];
  for(var i=0;i<all.length&&items.length<600;i++){
    var e=all[i]; var kind=kindOf(e); if(!kind) continue;
    if(!vis(e)){
      // a styled radio/checkbox hides its input: its visible label stands in
      if((kind==="radio"||kind==="checkbox")&&e.labels&&e.labels[0]&&vis(e.labels[0])){} else continue;
    }
    if(disabled(e)) continue;
    if(kind==="card"){
      var rr=e.getBoundingClientRect(); if(rr.width*rr.height>0.6*vw*vh) continue;
      var inner=e.querySelectorAll(INTER); if(inner.length>2) continue;
      var ct=txt(e).length, dup=false;
      for(var ii=0;ii<inner.length;ii++){ if(txt(inner[ii]).length>=0.6*ct) dup=true; }
      if(dup) continue;
    }
    var label=labelOf(e,kind).slice(0,140);
    if(kind!=="card"&&kind!=="textbox"&&kind!=="searchbox"&&kind!=="select"){
      // a link inside a button (or the reverse) with the same text is one control
      var outer=closestInteractive(e); if(outer&&outer.getAttribute("data-aux4-el")&&norm(labelOf(outer,kindOf(outer)||"button")).slice(0,140)===label) continue;
    }
    if(!label&&(kind==="card"||kind==="link"||kind==="option"||kind==="menuitem"||kind==="tab")) continue;
    if(!label&&kind==="button"){ label=norm(e.getAttribute("title")||e.getAttribute("name")||e.className&&String(e.className).split(/\s+/)[0]||"").slice(0,60); if(!label) continue; }
    if(!reachable(e)&&!((kind==="radio"||kind==="checkbox")&&e.labels&&e.labels[0]&&reachable(e.labels[0]))) continue;
    var ctx=contextOf(e);
    if(!INCLUDE_NAV&&(ctx.region==="header"||ctx.region==="nav"||ctx.region==="footer"||ctx.region==="aside")) continue;
    var it={id:id, kind:kind, tag:e.tagName.toLowerCase(), label:label, context:ctx.context, region:ctx.region, regionName:ctx.regionName, heading:ctx.heading, headingPath:ctx.headingPath};
    if(refOf.has(e)) it.ref=refOf.get(e);
    if(e.tagName==="INPUT") it.type=(e.getAttribute("type")||"text").toLowerCase();
    if(kind==="textbox"||kind==="searchbox"||(kind==="combobox"&&e.tagName==="INPUT")){
      var v=e.isContentEditable?txt(e):String(e.value||""); if(v) it.value=(it.type==="password")?"<filled>":v.slice(0,80);
      if(e.required||e.getAttribute("aria-required")==="true") it.required=true;
      if(e.maxLength>0&&e.maxLength<=4) it.maxLength=e.maxLength;
      if((e.getAttribute("role")||"")==="combobox"||e.hasAttribute("aria-autocomplete")||e.hasAttribute("aria-haspopup")||e.hasAttribute("list")||it.type==="search") it.auto=true;
    }
    if(kind==="select"){
      var o=e.options&&e.selectedIndex>=0?e.options[e.selectedIndex]:null; if(o&&o.value!=="") it.value=txt(o);
      it.options=Array.prototype.map.call(e.options||[],function(op){ return txt(op); }).filter(Boolean).slice(0,15);
      if(e.required) it.required=true;
    }
    if(kind==="combobox"&&e.tagName!=="INPUT"){ var cv=txt(e); if(cv) it.value=cv.slice(0,80); }
    if((kind==="button"||kind==="link")&&nameOf(e)){ var shown=txt(e); if(shown&&shown!==label&&shown.length<=80) it.value=shown; }
    if(kind==="button"&&e.tagName==="INPUT"&&e.readOnly&&e.value) it.value=String(e.value).slice(0,80);
    if(kind==="checkbox"||kind==="radio"||kind==="switch"){ it.checked=!!(e.checked||e.getAttribute("aria-checked")==="true"); }
    if(kind==="option"||kind==="tab"){ if(e.getAttribute("aria-selected")==="true") it.checked=true; }
    var ex=e.getAttribute("aria-expanded"); if(ex==="true"||ex==="false") it.expanded=(ex==="true");
    if(kind==="link"){ it.href=e.href||""; it.target=e.getAttribute("target")||""; }
    var tagEl=(!vis(e)&&e.labels&&e.labels[0])?e.labels[0]:e;
    tagEl.setAttribute("data-aux4-el",String(id)); it.el=e;
    items.push(it); id++;
  }
  // split fields: consecutive short text boxes sharing a container are ONE value
  var out=[];
  for(var k=0;k<items.length;k++){
    var a=items[k];
    if(a.kind==="textbox"&&a.maxLength){
      var grp=[a];
      for(var m=k+1;m<items.length;m++){
        var b=items[m]; if(b.kind!=="textbox"||!b.maxLength) break;
        var pa=parentEl(grp[grp.length-1].el), pb=parentEl(b.el);
        var near=pa===pb||(pa&&pb&&(parentEl(pa)===parentEl(pb)||parentEl(parentEl(pa))===parentEl(parentEl(pb))));
        if(!near) break; grp.push(b);
      }
      if(grp.length>=2){
        var cont=parentEl(a.el), glabel="";
        for(var up=0;up<4&&cont&&!glabel;up++,cont=parentEl(cont)){ glabel=nameOf(cont)||(cont.tagName==="FIELDSET"?txt(cont.querySelector("legend")):""); }
        var labels=grp.map(function(g){ return g.label; });
        if(!glabel){ glabel=labels[0]; if(labels.every(function(l){ return l===labels[0]; })===false) glabel=a.context.split(" > ").pop()||labels[0]; }
        var seg={id:a.id, kind:"segmented", tag:"input", label:glabel, context:a.context, region:a.region, regionName:a.regionName, heading:a.heading, headingPath:a.headingPath, ref:a.ref,
          parts:grp.map(function(g){ return g.id; }), lens:grp.map(function(g){ return g.maxLength; }),
          value:grp.map(function(g){ return g.value||""; }).join("")};
        if(grp.some(function(g){ return g.required; })) seg.required=true;
        out.push(seg); k+=grp.length-1; continue;
      }
    }
    out.push(a);
  }
  out.forEach(function(it){ delete it.el; delete it.maxLength; });
  var frames=[];
  if(!IS_FRAME){
    Array.prototype.forEach.call(document.querySelectorAll("iframe"),function(f){
      if(frames.length>=3||!vis(f)) return; var r=f.getBoundingClientRect(); if(r.width<100||r.height<50) return;
      if(dialog&&!inside(dialog,f)) return;
      var sel=f.id?("iframe#"+CSS.escape(f.id)):(f.getAttribute("name")?("iframe[name=\""+f.getAttribute("name").replace(/"/g,"\\\"")+"\"]"):(f.getAttribute("title")?("iframe[title=\""+f.getAttribute("title").replace(/"/g,"\\\"")+"\"]"):(f.getAttribute("src")?("iframe[src=\""+f.getAttribute("src").replace(/"/g,"\\\"")+"\"]"):"")));
      if(sel) frames.push(sel);
    });
  }
  var heads=[], hseen={};
  var hroot=dialog||document;
  var hsel="h1,h2,h3,legend,[role=status],[role=alert]";
  (dialog?[dialog]:[document]).forEach(function(r){ Array.prototype.forEach.call(r.querySelectorAll(hsel),function(h){ if(heads.length>=12||!vis(h)) return; var t=txt(h).slice(0,200); if(t&&!hseen[t]){ hseen[t]=1; heads.push(t); } }); });
  var errs=[], eseen={};
  ['[role="alert"]','.error','.invalid','.validation-error','[aria-invalid="true"]'].forEach(function(s){
    Array.prototype.forEach.call(document.querySelectorAll(s),function(x){ if(!vis(x)) return; var t=norm(x.textContent).slice(0,200); if(t&&!eseen[t]){ eseen[t]=1; errs.push(t); } });
  });
  // visible text blocks outside page chrome (own text of each element)
  var CHROME="header,nav,footer,aside,[role=banner],[role=navigation],[role=contentinfo]";
  var blocks=[], bseen={}, blen=0;
  var broot=dialog||document.body;
  if(broot){
    var tw=document.createTreeWalker(broot, NodeFilter.SHOW_TEXT, null);
    var n, lastEl=null, cur="";
    var flush=function(){ var t=norm(cur); if(t.length>1&&!bseen[t]){ bseen[t]=1; blocks.push(t.slice(0,200)); blen+=t.length; } cur=""; };
    while((n=tw.nextNode())&&blocks.length<400&&blen<20000){
      var pe=n.parentElement; if(!pe||SKIP[pe.tagName]) continue;
      if(!n.nodeValue||!n.nodeValue.trim()) continue;
      if(pe!==lastEl){ flush(); lastEl=pe; if(pe.closest(CHROME)&&!(dialog&&inside(dialog,pe))){ lastEl=null; continue; } if(!vis(pe)){ lastEl=null; continue; } }
      if(lastEl) cur+=" "+n.nodeValue;
    }
    flush();
  }
  var mainEl=dialog||document.querySelector("main,[role=main]");
  var summary=mainEl?norm(mainEl.innerText||"").slice(0,1200):blocks.join(" | ").slice(0,1200);
  var res={url:location.href, title:document.title, dialog:dialogName, actions:out, frames:frames, next:id};
  if(WITH_PAGE) res.page={headings:heads, errors:errs, text:summary, blocks:blocks, textLength:(document.body?norm(document.body.innerText).length:0)};
  return res;
}


async function frameFor(page, within) {
  let frame = page.mainFrame();
  for (const sel of String(within).split(">>>").map(s => s.trim()).filter(Boolean)) {
    const handle = await frame.locator(sel).first().elementHandle({ timeout: 5000 });
    const child = handle ? await handle.contentFrame() : null;
    if (handle) await handle.dispose();
    if (!child) throw new Error(`actions: no frame for --within "${sel}"`);
    frame = child;
  }
  return frame;
}

function shape(item, within) {
  const out = {
    id: item.id,
    ref: item.ref != null ? item.ref : null,
    role: item.kind,
    tag: item.tag,
    label: item.label
  };
  if (item.type) out.type = item.type;
  if (item.value) out.value = item.value;
  if (item.checked != null) out.checked = item.checked;
  if (item.expanded != null) out.expanded = item.expanded;
  if (item.required) out.required = true;
  if (item.options && item.options.length) out.options = item.options;
  if (item.parts) { out.parts = item.parts; out.lens = item.lens; }
  if (item.href) out.href = item.href;
  if (item.target) out.target = item.target;
  if (item.auto) out.autocomplete = true;
  out.context = {
    region: item.region,
    ...(item.regionName ? { name: item.regionName } : {}),
    headingPath: item.headingPath || [],
    text: item.context || ""
  };
  out.selector = `[data-aux4-el="${item.id}"]`;
  if (within) { out.within = within; out.ref = null; }
  return out;
}

export class ActionsBuilder {
  static async build(page, params = {}) {
    const includeNav = params.includeNav === true || params.includeNav === "true";
    const withPage = params.page === true || params.page === "true";
    if (params.within) {
      const frame = await frameFor(page, params.within);
      const res = await frame.evaluate(collectActions, { start: 1, includeNav, withPage, isFrame: true });
      const out = { url: res.url, title: res.title, dialog: res.dialog, actions: res.actions.map(a => shape(a, params.within)) };
      if (withPage) out.page = res.page;
      return out;
    }
    const main = await page.evaluate(collectActions, { start: 1, includeNav, withPage, isFrame: false });
    const out = { url: main.url, title: main.title, dialog: main.dialog, actions: main.actions.map(a => shape(a, "")) };
    if (withPage) out.page = main.page;
    let next = main.next;
    for (const within of (main.frames || []).slice(0, 3)) {
      try {
        const frame = await frameFor(page, within);
        const res = await Promise.race([
          frame.evaluate(collectActions, { start: next, includeNav, withPage, isFrame: true }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000))
        ]);
        next = res.next;
        out.actions.push(...res.actions.map(a => shape(a, within)));
        if (withPage && res.page) {
          out.page.errors.push(...res.page.errors);
          out.page.textLength += res.page.textLength;
        }
      } catch {
        // detached or unreachable frame
      }
    }
    out.count = out.actions.length;
    return out;
  }
}
