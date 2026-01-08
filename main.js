(() => {
  'use strict';

  /* ---------------- core ---------------- */
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const uid=(()=>{let i=1;return()=> (i++).toString(36)})();

  const Store = {
    nodes:[], cables:[], selection:new Set(),
    zoom:1, pan:{x:0,y:0},
    snap:true, dirty:true,
  };

  const CommandStack=(()=>{const u=[],r=[],MAX=100;
    function exec(c){c.do();u.push(c);if(u.length>MAX)u.shift();r.length=0;Store.dirty=true}
    return {exec,undo(){const c=u.pop();if(c){c.undo();r.push(c);Store.dirty=true}},redo(){const c=r.pop();if(c){c.do();u.push(c);Store.dirty=true}},push(doFn,undoFn){exec({do:doFn,undo:undoFn})}};
  })();

  let last=performance.now();
  function tick(now){
    const dt=(now-last)/1000; last=now;
    Logic.update(dt);
    if(Store.dirty) Renderer.render();
    requestAnimationFrame(tick);
  }

  /* ---------------- models ---------------- */
  const TYPES={POWER:'power',VIDEO:'video',DATA:'data'};
  const PortDir={IN:'in',OUT:'out'};
  const P=(name,type,dir)=>({name,type,dir});

  const Models={
    PowerSupply:{label:'Power Supply',size:{w:160,h:90},inPorts:[],outPorts:[P('power',TYPES.POWER,PortDir.OUT)],make(){return{ name:'Power',on:true,voltage:12 }},update(){}},
    Motherboard:{label:'Motherboard',size:{w:200,h:130},inPorts:[P('power',TYPES.POWER,PortDir.IN)],outPorts:[P('video',TYPES.VIDEO,PortDir.OUT),P('data',TYPES.DATA,PortDir.OUT)],
      make(){return{ name:'MB',mode:'white',fps:60,color:'#ffffff',dosType:'link',dosUrl:'' }},update(){}},
    Screen:{label:'Screen',size:{w:200,h:150},inPorts:[P('power',TYPES.POWER,PortDir.IN),P('video',TYPES.VIDEO,PortDir.IN)],outPorts:[],
      make(){return{ name:'Screen',brightness:100,scale:1.0,color:'#ffffff',test:false,state:'off',display:'#000000',imgUrl:'' }},update(){}},
    Switch:{label:'Switch',size:{w:150,h:90},inPorts:[P('powerIn',TYPES.POWER,PortDir.IN)],outPorts:[P('powerOut',TYPES.POWER,PortDir.OUT)],make(){return{ name:'Switch',on:true }},update(){}},
    LED:{label:'LED',size:{w:140,h:90},inPorts:[P('power',TYPES.POWER,PortDir.IN)],outPorts:[],make(){return{ name:'LED',lit:false }},update(){}},
    Sensor:{label:'Sensor',size:{w:160,h:90},inPorts:[P('power',TYPES.POWER,PortDir.IN)],outPorts:[P('data',TYPES.DATA,PortDir.OUT)],make(){return{ name:'Sensor',value:0 }},update(){}},
    Splitter:{label:'Splitter',size:{w:160,h:90},inPorts:[P('in',TYPES.POWER,PortDir.IN)],outPorts:[P('a',TYPES.POWER,PortDir.OUT),P('b',TYPES.POWER,PortDir.OUT)],make(){return{ name:'Splitter' }},update(){}},
    CableSpool:{label:'Cable Spool',size:{w:140,h:70},inPorts:[],outPorts:[],make(){return{ name:'Cable Spool' }},update(){}},
  };

  function createNode(type,x,y){
    const model=Models[type]; const id=uid();
    return {id,type,x,y,r:0,props:model.make(),ports:{inputs:model.inPorts.map(p=>({...p})),outputs:model.outPorts.map(p=>({...p}))}};
  }

  /* ---------------- signals & logic ---------------- */
  const Signals={power:new Map(),video:new Map(),data:new Map()};
  const key=(id,port)=>id+':'+port;
  const getOut=(type,id,port)=>Signals[type].get(key(id,port));
  const setOut=(type,id,port,val)=>Signals[type].set(key(id,port),val);

  const Logic={
    update(){
      function readInput(node,portName,type){
        const c=Store.cables.find(c=>c.to.nodeId===node.id && c.to.port===portName);
        if(!c) return null; return getOut(type,c.from.nodeId,c.from.port);
      }
      for(const node of Store.nodes){
        switch(node.type){
          case 'PowerSupply':{
            const out=(node.props.on && node.props.voltage>0)?{on:true,v:node.props.voltage}:{on:false,v:0};
            setOut('power',node.id,'power',out); break;
          }
          case 'Switch':{
            const inp=readInput(node,'powerIn','power');
            const out=(node.props.on && inp?.on)?inp:{on:false,v:0};
            setOut('power',node.id,'powerOut',out); break;
          }
          case 'Splitter':{
            const inp=readInput(node,'in','power')||{on:false,v:0};
            setOut('power',node.id,'a',inp); setOut('power',node.id,'b',inp); break;
          }
          case 'Motherboard':{
            const pwr=readInput(node,'power','power'); let video={kind:'none'};
            if(pwr?.on){
              if(node.props.mode==='white') video={kind:'white'};
              else if(node.props.mode==='color') video={kind:'color',color:node.props.color||'#ffffff'};
              else if(node.props.mode==='DosOS'){
                if(node.props.dosType==='link' && node.props.dosUrl){ video={kind:'image',url:node.props.dosUrl}; }
                else { video={kind:'white'}; }
              }
            }
            setOut('video',node.id,'video',video);
            setOut('data',node.id,'data',{});
            break;
          }
          case 'Screen':{
            const pwr=readInput(node,'power','power');
            const vid=readInput(node,'video','video')||{kind:'none'};
            let display='#000000', state='off', imgUrl='';
            if(pwr?.on){
              state='on';
              if(node.props.test){ display=node.props.color||'#ffffff'; }
              else if(vid.kind==='white'){ display='#ffffff'; }
              else if(vid.kind==='color'){ display=vid.color||'#ffffff'; }
              else if(vid.kind==='image'){ imgUrl=vid.url||''; }
              else { state='standby'; display='#0b0b0b'; }
              display=modulateBrightness(display,node.props.brightness);
            }
            node.props.state=state; node.props.display=display; node.props.imgUrl=imgUrl;
            break;
          }
          case 'LED':{
            const pwr=readInput(node,'power','power'); node.props.lit=!!pwr?.on; break;
          }
          case 'Sensor':{
            const pwr=readInput(node,'power','power');
            setOut('data',node.id,'data', pwr?.on ? {value:Math.floor(performance.now()/250)%2} : null); break;
          }
        }
      }
      Store.dirty=true;
    }
  };

  function modulateBrightness(hex,brightness){
    const b=clamp((brightness??100)/100,0,1);
    const {r,g,bv}=hexToRgb(hex);
    return rgbToHex(Math.round(r*b),Math.round(g*b),Math.round(bv*b));
  }
  function hexToRgb(hex){
    const h=hex.replace('#','');
    const n=parseInt(h,16);
    return {r:(n>>16)&255,g:(n>>8)&255,bv:n&255};
  }
  function rgbToHex(r,g,b){return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('')}

  /* ---------------- stage ---------------- */
  const Stage={
    svg:document.getElementById('stage'),
    view:document.getElementById('view'),
    groupCables:document.getElementById('cables'),
    groupNodes:document.getElementById('nodes'),
    dragGhosts:document.getElementById('drag-ghosts'),
    grid:document.getElementById('grid-canvas'),
  };

  /* ---------------- renderer (incl. grid) ---------------- */
  const Renderer={
    render(){
      Store.dirty=false;
      const {x,y}=Store.pan, s=Store.zoom;
      Stage.view.setAttribute('transform',`translate(${x},${y}) scale(${s})`);
      document.getElementById('zoom-label').textContent=Math.round(s*100)+'%';
      drawGrid();
      this.syncCables(); this.syncNodes();
    },
    syncNodes(){
      const ids=new Set(Store.nodes.map(n=>n.id));
      [...Stage.groupNodes.children].forEach(ch=>{if(!ids.has(ch.dataset.id)) ch.remove()});
      for(const node of Store.nodes){
        let g=Stage.groupNodes.querySelector(`[data-id="${node.id}"]`);
        if(!g){ g=this.drawNode(node); Stage.groupNodes.appendChild(g); }
        this.updateNode(g,node);
      }
    },
    drawNode(node){
      const model=Models[node.type];
      const g=svgEl('g',{class:'node',tabindex:'0','data-id':node.id,style:'pointer-events:all'});
      g.addEventListener('mousedown',onNodeMouseDown);
      g.addEventListener('click',(e)=>{if(!isPanning) selectOnly(node.id,e.shiftKey); e.stopPropagation();});
      const {w,h}=model.size;

      // body + title strip
      const body=svgEl('rect',{class:'body',x:node.x,y:node.y,width:w,height:h,rx:10,ry:10}); g.appendChild(body);
      const tbg =svgEl('rect',{class:'title-bg',x:node.x,y:node.y,width:w,height:22,rx:10,ry:10}); g.appendChild(tbg);
      const title=svgEl('text',{class:'title',x:node.x+10,y:node.y+15}); title.textContent=model.label; g.appendChild(title);

      // picture
      const pic=svgEl('g',{class:'pic'}); pic.setAttribute('transform',`translate(${node.x+10},${node.y+30})`); pic.appendChild(nodeIcon(node.type)); g.appendChild(pic);

      // special visuals
      if(node.type==='Screen'){
        const screen=svgEl('rect',{x:node.x+54,y:node.y+30,width:w-64,height:h-46,rx:6,ry:6,'data-role':'display',stroke:'#111827','stroke-width':1,fill:'#000'}); g.appendChild(screen);
        const image=svgEl('image',{'data-role':'display-img',href:'',x:node.x+54,y:node.y+30,width:w-64,height:h-46,preserveAspectRatio:'xMidYMid slice',style:'display:none'}); g.appendChild(image);
      }
      if(node.type==='LED'){
        const led=svgEl('circle',{cx:node.x+w/2,cy:node.y+h/2,r:10,'data-role':'led',stroke:'#111827','stroke-width':1,fill:'#111'}); g.appendChild(led);
      }

      // UE-like pins
      const portOffset=22;
      node.ports.inputs.forEach((p,i)=>{
        const cx=node.x+10, cy=node.y+34+i*portOffset;
        const portG=drawPort(node,p,cx,cy,'input'); g.appendChild(portG);
      });
      node.ports.outputs.forEach((p,i)=>{
        const cx=node.x+model.size.w-10, cy=node.y+34+i*portOffset;
        const portG=drawPort(node,p,cx,cy,'output'); g.appendChild(portG);
      });

      return g;
    },
    updateNode(g,node){
      g.classList.toggle('selected',Store.selection.has(node.id));
      const model=Models[node.type]; const {w,h}=model.size;

      g.querySelector('rect.body').setAttribute('x',node.x);
      g.querySelector('rect.body').setAttribute('y',node.y);
      g.querySelector('rect.body').setAttribute('width',w);
      g.querySelector('rect.body').setAttribute('height',h);

      const tbg=g.querySelector('rect.title-bg');
      tbg.setAttribute('x',node.x); tbg.setAttribute('y',node.y);
      tbg.setAttribute('width',w);  tbg.setAttribute('height',22);

      const title=g.querySelector('text.title');
      title.setAttribute('x',node.x+10); title.setAttribute('y',node.y+15);

      g.querySelector('.pic')?.setAttribute('transform',`translate(${node.x+10},${node.y+30})`);

      if(node.type==='Screen'){
        const rect=g.querySelector('[data-role="display"]');
        const img =g.querySelector('[data-role="display-img"]');
        rect.setAttribute('x',node.x+54); rect.setAttribute('y',node.y+30);
        rect.setAttribute('width',w-64);  rect.setAttribute('height',h-46);
        img.setAttribute('x',node.x+54); img.setAttribute('y',node.y+30);
        img.setAttribute('width',w-64);  img.setAttribute('height',h-46);

        const hasImg = !!node.props.imgUrl;
        if(hasImg){ img.setAttribute('href',node.props.imgUrl); img.style.display='block'; rect.setAttribute('fill','#000'); }
        else { img.style.display='none'; rect.setAttribute('fill',node.props.display||'#000'); }
      }
      if(node.type==='LED'){
        const led=g.querySelector('[data-role="led"]');
        led.setAttribute('cx',node.x+w/2); led.setAttribute('cy',node.y+h/2);
        led.setAttribute('fill',node.props.lit? '#22c55e' : '#0b0b0b');
      }

      const portGs=[...g.querySelectorAll('.port')]; const portOffset=22; let iIn=0,iOut=0;
      for(const pg of portGs){
        const isOut=pg.classList.contains('output');
        const cx=isOut? node.x+model.size.w-10 : node.x+10;
        const cy=node.y+34+(isOut? iOut++ : iIn++)*portOffset;
        pg.setAttribute('transform',`translate(${cx},${cy})`);
      }
    },
    syncCables(){
      const ids=new Set(Store.cables.map(c=>c.id));
      [...Stage.groupCables.children].forEach(ch=>{if(!ids.has(ch.dataset.id)) ch.remove()});
      for(const cable of Store.cables){
        let p=Stage.groupCables.querySelector(`[data-id="${cable.id}"]`);
        if(!p){
          p=svgEl('path',{class:`cable ${cable.type}`,'data-id':cable.id,'marker-end':'url(#arrow)','stroke-linecap':'round'});
          p.addEventListener('click',(e)=>{selectOnly(cable.id,false,true); e.stopPropagation();});
          Stage.groupCables.appendChild(p);
        }
        p.classList.toggle('selected',Store.selection.has(cable.id));
        const from=getPortPos(cable.from.nodeId,cable.from.port,true);
        const to=getPortPos(cable.to.nodeId,cable.to.port,false);
        p.setAttribute('d',bezierPath(from,to));
      }
    }
  };

  /* ---------- grid drawing (aligned with pan/zoom) ---------- */
  function drawGrid(){
    const c=Stage.grid, ctx=c.getContext('2d');
    const rect=c.parentElement.getBoundingClientRect();
    const dpr=window.devicePixelRatio||1;
    c.width=rect.width*dpr; c.height=rect.height*dpr;
    c.style.width=rect.width+'px'; c.style.height=rect.height+'px';
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,c.width,c.height);

    const step=20*Store.zoom*dpr;
    if(step<6) return;

    const ox=(Store.pan.x%step+dpr*0.5);
    const oy=(Store.pan.y%step+dpr*0.5);

    ctx.lineWidth=1;
    ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--grid1').trim()||'#dbe2ee';
    ctx.globalAlpha=0.85;

    ctx.beginPath();
    for(let x=ox; x<=c.width; x+=step){ ctx.moveTo(x,0); ctx.lineTo(x,c.height); }
    for(let y=oy; y<=c.height; y+=step){ ctx.moveTo(0,y); ctx.lineTo(c.width,y); }
    ctx.stroke();

    const major=step*5;
    ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--grid2').trim()||'#c5cedf';
    ctx.lineWidth=1.2;
    ctx.beginPath();
    const mx=ox%major, my=oy%major;
    for(let x=mx; x<=c.width; x+=major){ ctx.moveTo(x,0); ctx.lineTo(x,c.height); }
    for(let y=my; y<=c.height; y+=major){ ctx.moveTo(0,y); ctx.lineTo(c.width,y); }
    ctx.stroke();
  }

  /* ---------------- SVG helpers ---------------- */
  function svgEl(tag,attrs){const el=document.createElementNS('http://www.w3.org/2000/svg',tag); if(attrs) for(const k in attrs) el.setAttribute(k,attrs[k]); return el;}
  function nodeIcon(type){
    const g=svgEl('g',{'stroke':'#111','fill':'none','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round'});
    switch(type){
      case 'PowerSupply': g.innerHTML=`<rect x="0" y="0" width="28" height="24" rx="3"/><path d="M28 5h8M28 19h8M36 5v14M46 12h6"/>`; break;
      case 'Motherboard': g.innerHTML=`<rect x="0" y="0" width="42" height="28" rx="3"/><rect x="8" y="8" width="14" height="12"/><path d="M34 6v4M34 14v8M4 6h4M4 14h4M4 22h4"/>`; break;
      case 'Screen': g.innerHTML=`<rect x="0" y="0" width="42" height="28" rx="3"/><path d="M10 34h22M21 28v6"/>`; break;
      case 'Switch': g.innerHTML=`<rect x="0" y="6" width="42" height="16" rx="8"/><circle cx="14" cy="14" r="6"/>`; break;
      case 'LED': g.innerHTML=`<circle cx="14" cy="12" r="8"/><path d="M14 20v14M8 30h12"/>`; break;
      case 'Sensor': g.innerHTML=`<rect x="0" y="0" width="42" height="28" rx="3"/><path d="M8 8h26M8 18h26"/>`; break;
      case 'Splitter': g.innerHTML=`<path d="M6 0v40M6 20h20M6 20H-8"/>`; break;
      case 'CableSpool': g.innerHTML=`<circle cx="20" cy="14" r="12"/><circle cx="20" cy="14" r="3"/>`; break;
    }
    return g;
  }

  /* ---------------- pan/zoom (LEFT drag) ---------------- */
  let isPanning=false, panStart={x:0,y:0}, mouseStart={x:0,y:0};
  Stage.svg.addEventListener('mousedown',(e)=>{
    if(e.button===0 && (e.target===Stage.svg || e.target===Stage.view)){
      isPanning=true; panStart={...Store.pan}; mouseStart={x:e.clientX,y:e.clientY};
      Store.selection.clear(); updateInspector(); Store.dirty=true;
    }
  });
  window.addEventListener('mousemove',(e)=>{
    if(isPanning){
      const dx=e.clientX-mouseStart.x, dy=e.clientY-mouseStart.y;
      Store.pan.x=panStart.x+dx; Store.pan.y=panStart.y+dy; Store.dirty=true;
    }
  });
  window.addEventListener('mouseup',()=>{isPanning=false;});
  Stage.svg.addEventListener('wheel',(e)=>{
    e.preventDefault();
    const factor=e.deltaY>0?0.9:1.1, old=Store.zoom; const z=clamp(old*factor,0.25,2.0);
    const pt=clientToSvg(e.clientX,e.clientY);
    const wx=(pt.x-Store.pan.x)/old, wy=(pt.y-Store.pan.y)/old;
    Store.zoom=z; Store.pan.x=pt.x-wx*z; Store.pan.y=pt.y-wy*z; Store.dirty=true;
  },{passive:false});

  function clientToSvg(cx,cy){const r=Stage.svg.getBoundingClientRect(); return {x:cx-r.left,y:cy-r.top}}
  function screenToWorld(pt){return {x:(pt.x-Store.pan.x)/Store.zoom,y:(pt.y-Store.pan.y)/Store.zoom}}
  function snap(v,step){return Math.round(v/step)*step}

  /* ---------------- toolbox drag/drop ---------------- */
  document.querySelectorAll('.toolbox [draggable="true"]').forEach(el=>{
    el.addEventListener('dragstart',(e)=>{e.dataTransfer.setData('text/plain',el.dataset.component);});
  });
  document.querySelector('.canvas-wrap').addEventListener('dragover',(e)=>e.preventDefault());
  document.querySelector('.canvas-wrap').addEventListener('drop',(e)=>{
    e.preventDefault();
    const type=e.dataTransfer.getData('text/plain'); if(!Models[type]) return;
    const pt=clientToSvg(e.clientX,e.clientY); const local=screenToWorld(pt);
    const x=snap(local.x,10), y=snap(local.y,10);
    const node=createNode(type,x,y);
    CommandStack.push(()=>{Store.nodes.push(node); selectOnly(node.id);},()=>{removeNodeById(node.id);});
  });

  /* ---------------- node drag/duplicate ---------------- */
  let dragState=null;
  function onNodeMouseDown(e){
    if(e.button!==0) return;
    const g=e.currentTarget; const id=g.dataset.id; const node=Store.nodes.find(n=>n.id===id); if(!node) return;
    if(!Store.selection.has(id)) selectOnly(id,e.shiftKey);
    const start=screenToWorld(clientToSvg(e.clientX,e.clientY));
    const initial=[...Store.selection].map(selId=>{const n=Store.nodes.find(nn=>nn.id===selId);return {id:selId,x:n.x,y:n.y}});
    const duplicate=e.altKey; dragState={start,initial,duplicate,spawned:[]};
    window.addEventListener('mousemove',onNodeDrag);
    window.addEventListener('mouseup',onNodeDrop,{once:true});
  }
  function onNodeDrag(e){
    if(!dragState) return;
    const cur=screenToWorld(clientToSvg(e.clientX,e.clientY));
    const dx=cur.x-dragState.start.x, dy=cur.y-dragState.start.y;

    if(dragState.duplicate && dragState.spawned.length===0){
      const clones=[];
      for(const selId of Store.selection){
        const base=Store.nodes.find(n=>n.id===selId); const c=JSON.parse(JSON.stringify(base)); c.id=uid();
        clones.push(c);
      }
      CommandStack.push(()=>{clones.forEach(c=>Store.nodes.push(c)); Store.selection=new Set(clones.map(c=>c.id));},()=>{
        clones.forEach(c=>removeNodeById(c.id));
      });
      dragState.spawned=clones.map(c=>c.id);
    }

    for(const selId of Store.selection){
      const node=Store.nodes.find(n=>n.id===selId);
      const pos=dragState.initial.find(p=>p.id===selId);
      let nx=pos.x+dx, ny=pos.y+dy;
      nx=snap(nx,10); ny=snap(ny,10);
      node.x=nx; node.y=ny;
    }
    Store.dirty=true;
  }
  function onNodeDrop(){ dragState=null; window.removeEventListener('mousemove',onNodeDrag); }

  /* ---------------- CLICK-TO-CONNECT ports ---------------- */
  function drawPort(node, port, cx, cy, role){
    const g = svgEl('g', {
      class: `port ${role}`,
      'data-node': node.id,
      'data-port': port.name,
      'data-type': port.type,
      transform: `translate(${cx},${cy})`
    });

    const ring = svgEl('circle', { class: 'ring', r: 8 });
    const core = svgEl('circle', { class: 'core', r: 5 });

    const label = svgEl('text', {
      x: role === 'input' ? -12 : 12,
      y: 4,
      'text-anchor': role === 'input' ? 'end' : 'start',
      'font-size': 10,
      fill: '#374151'
    });
    label.textContent = port.name;

    const tip = svgEl('title');
    tip.textContent = `${role === 'input' ? 'In' : 'Out'} · ${port.type}`;

    g.appendChild(ring);
    g.appendChild(core);
    g.appendChild(label);
    g.appendChild(tip);

    g.addEventListener('click', onPortClick);
    g.addEventListener('mouseenter', () => highlightCompat(port.type, role, true));
    g.addEventListener('mouseleave', () => highlightCompat(null, role, false));

    return g;
  }

  let activePort = null; // {nodeId, port, type, isOutput}
  let tempPath = null;
  let lastMouse = { x: 0, y: 0 };

  Stage.svg.addEventListener('mousemove', (e) => {
    lastMouse = clientToSvg(e.clientX, e.clientY);
    if (activePort && tempPath) updateTempLineToMouse(lastMouse);
  });

  function onPortClick(e){
    e.stopPropagation();
    const g = e.currentTarget;
    const nodeId = g.dataset.node;
    const port = g.dataset.port;
    const type = g.dataset.type;
    const isOutput = g.classList.contains('output');

    if (!activePort) {
      if (!isOutput) { return flashHint('Start from an output port'); }
      setActivePort({ nodeId, port, type, isOutput: true });
      return;
    }

    if (isOutput) { return flashHint('Connect output → input'); }
    if (activePort.type !== type) { return flashHint('Incompatible port (need '+activePort.type+')'); }

    const exists = Store.cables.find(c => c.to.nodeId === nodeId && c.to.port === port);
    if (exists) { clearActivePort(); return flashHint('Input already connected'); }

    if (pathExists(nodeId, activePort.nodeId, type)) { clearActivePort(); return flashHint('Cycle prevented'); }

    const cable = { id: uid(), type, from: { nodeId: activePort.nodeId, port: activePort.port }, to: { nodeId, port } };
    CommandStack.push(()=>{Store.cables.push(cable); Store.dirty=true;},()=>{
      const i=Store.cables.findIndex(c=>c.id===cable.id); if(i>=0) Store.cables.splice(i,1);
    });
    clearActivePort();
  }

  function setActivePort(info){
    activePort = info;
    Stage.dragGhosts.innerHTML = '';
    tempPath = svgEl('path', { class: `cable ${info.type}`, 'stroke-linecap':'round' });
    Stage.dragGhosts.appendChild(tempPath);
    updateTempLineToMouse(lastMouse);
    window.addEventListener('keydown', onTempLineCancel);
    flashHint('Now click a compatible input');
  }
  function clearActivePort(){
    activePort = null;
    Stage.dragGhosts.innerHTML = '';
    tempPath = null;
    window.removeEventListener('keydown', onTempLineCancel);
    Store.dirty = true;
  }
  function updateTempLineToMouse(pt){
    if (!activePort || !tempPath) return;
    const from = getPortPos(activePort.nodeId, activePort.port, true);
    const to = screenToWorld(pt); // Convert mouse position to world space
    tempPath.setAttribute('d', bezierPath(from, to));
  
  }
  function onTempLineCancel(e){
    if (e.key === 'Escape') { clearActivePort(); flashHint('Canceled'); }
  }

  function highlightCompat(type,role,on){
    document.querySelectorAll(`#nodes .port.${role==='input'?'output':'input'}`).forEach(p=>{
      const t=p.dataset.type; if(on && type && t===type) p.classList.add('compat'); else p.classList.remove('compat');
    });
  }
  function tryConnect(from,to){
    if(from.type!==to.type){ return flashHint('Incompatible port (expected '+from.type+')'); }
    const exists=Store.cables.find(c=>c.to.nodeId===to.nodeId && c.to.port===to.port); if(exists){ return flashHint('Input already connected'); }
    if(pathExists(to.nodeId,from.nodeId,from.type)){ return flashHint('Cycle prevented'); }
    const cable={id:uid(),type:from.type,from,to};
    CommandStack.push(()=>{Store.cables.push(cable);},()=>{
      const i=Store.cables.findIndex(c=>c.id===cable.id); if(i>=0) Store.cables.splice(i,1);
    });
  }
  function pathExists(src,dst,type){
    const seen=new Set(), st=[src];
    while(st.length){ const nid=st.pop(); if(nid===dst) return true; if(seen.has(nid)) continue; seen.add(nid);
      for(const c of Store.cables){ if(c.type!==type) continue; if(c.from.nodeId===nid) st.push(c.to.nodeId); }
    }
    return false;
  }
  function getPortPos(nodeId, portName, isOut) {
    const node = Store.nodes.find(n => n.id === nodeId);
    if (!node) return { x: 0, y: 0 };
  
    const model = Models[node.type];
    const portOffset = 22;
    let x, y;
  
    if (isOut) {
      const portIndex = model.outPorts.findIndex(p => p.name === portName);
      x = node.x + model.size.w - 10;
      y = node.y + 34 + portIndex * portOffset;
    } else {
      const portIndex = model.inPorts.findIndex(p => p.name === portName);
      x = node.x + 10;
      y = node.y + 34 + portIndex * portOffset;
    }
    return { x, y };
  }
  function bezierPath(a,b){
    const dx=Math.max(40,Math.abs(b.x-a.x)*0.5);
    const c1x=a.x+dx,c1y=a.y; const c2x=b.x-dx,c2y=b.y;
    return `M ${a.x} ${a.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${b.x} ${b.y}`;
  }

  function selectOnly(id,add=false){
    if(!add) Store.selection.clear(); if(id) Store.selection.add(id);
    updateInspector(); Store.dirty=true;
  }

  /* ---------------- deletion & undo/redo ---------------- */
  window.addEventListener('keydown',(e)=>{
    if(e.key==='Delete'){ const ids=[...Store.selection]; if(!ids.length) return;
      CommandStack.push(()=>{ids.forEach(id=>removeAnyById(id)); Store.selection.clear();},()=>{});
    }
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='z'){ e.preventDefault(); CommandStack.undo(); }
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='y'){ e.preventDefault(); CommandStack.redo(); }
  });
  function removeAnyById(id){
    if(Store.nodes.find(n=>n.id===id)) removeNodeById(id);
    const ic=Store.cables.findIndex(c=>c.id===id); if(ic>=0) Store.cables.splice(ic,1);
  }
  function removeNodeById(id){
    const i=Store.nodes.findIndex(n=>n.id===id); if(i>=0) Store.nodes.splice(i,1);
    for(let k=Store.cables.length-1;k>=0;k--){ const c=Store.cables[k]; if(c.from.nodeId===id||c.to.nodeId===id) Store.cables.splice(k,1); }
  }

  /* ---------------- inspector ---------------- */
  const inspector=document.getElementById('inspector-content');
  function updateInspector(){
    const ids=[...Store.selection];
    if(ids.length!==1){ inspector.textContent='Nothing selected.'; return; }
    const id=ids[0]; const node=Store.nodes.find(n=>n.id===id);
    if(!node){ inspector.textContent='Nothing selected.'; return; }
    let html=`
      <div class="prop"><label>Name</label><input id="prop-name" type="text" value="${node.props.name||''}"></div>
      <div class="prop"><label>Type</label><input type="text" value="${node.type}" disabled></div>
      <div class="prop"><label>X</label><input id="prop-x" type="number" value="${Math.round(node.x)}"></div>
      <div class="prop"><label>Y</label><input id="prop-y" type="number" value="${Math.round(node.y)}"></div>
    `;
    if(node.type==='PowerSupply'){
      html+=`<div class="prop"><label>On</label><select id="prop-on"><option value="true" ${node.props.on?'selected':''}>On</option><option value="false" ${!node.props.on?'selected':''}>Off</option></select></div>
             <div class="prop"><label>Voltage (V)</label><input id="prop-v" type="number" min="5" max="12" value="${node.props.voltage}"></div>`;
    }
    if(node.type==='Motherboard'){
      html+=`<div class="prop"><label>FPS</label><input id="prop-fps" type="number" min="1" max="144" value="${node.props.fps}"></div>
             <div class="prop"><label>Video Mode</label><select id="prop-mode">
                <option value="white" ${node.props.mode==='white'?'selected':''}>white</option>
                <option value="color" ${node.props.mode==='color'?'selected':''}>color</option>
                <option value="DosOS" ${node.props.mode==='DosOS'?'selected':''}>DosOS</option>
              </select></div>
             <div class="prop"><label>Color</label><input id="prop-color" type="color" value="${node.props.color}"></div>
             <div class="prop"><label>DosOS Type</label><select id="prop-dostype">
                <option value="link" ${node.props.dosType==='link'?'selected':''}>link</option>
             </select></div>
             <div class="prop"><label>DosOS URL</label><input id="prop-dosurl" type="text" placeholder="https://… (image/GIF)" value="${node.props.dosUrl||''}"></div>`;
    }
    if(node.type==='Screen'){
      html+=`<div class="prop"><label>Brightness</label><input id="prop-br" type="number" min="0" max="100" value="${node.props.brightness}"></div>
             <div class="prop"><label>Scale</label><input id="prop-scale" type="number" step="0.1" min="0.5" max="2.0" value="${node.props.scale}"></div>
             <div class="prop"><label>Test Image</label><select id="prop-test"><option value="false" ${!node.props.test?'selected':''}>Off</option><option value="true" ${node.props.test?'selected':''}>On</option></select></div>
             <div class="prop"><label>Test Color</label><input id="prop-scolor" type="color" value="${node.props.color}"></div>
             <div class="prop"><label>State</label><input type="text" value="${node.props.state}" disabled></div>`;
    }
    if(node.type==='Switch'){
      html+=`<div class="prop"><label>On</label><select id="prop-sw"><option value="true" ${node.props.on?'selected':''}>On</option><option value="false" ${!node.props.on?'selected':''}>Off</option></select></div>`;
    }
    inspector.innerHTML=html;

    inspector.querySelector('#prop-name')?.addEventListener('input',e=>{node.props.name=e.target.value;});
    inspector.querySelector('#prop-x')?.addEventListener('change',e=>{node.x=snap(+e.target.value||0,10); Store.dirty=true;});
    inspector.querySelector('#prop-y')?.addEventListener('change',e=>{node.y=snap(+e.target.value||0,10); Store.dirty=true;});

    inspector.querySelector('#prop-on')?.addEventListener('change',e=>{node.props.on=(e.target.value==='true');});
    inspector.querySelector('#prop-v')?.addEventListener('change',e=>{node.props.voltage=+e.target.value||0;});

    inspector.querySelector('#prop-fps')?.addEventListener('change',e=>{node.props.fps=+e.target.value||60;});
    inspector.querySelector('#prop-mode')?.addEventListener('change',e=>{node.props.mode=e.target.value;});
    inspector.querySelector('#prop-color')?.addEventListener('change',e=>{node.props.color=e.target.value;});
    inspector.querySelector('#prop-dostype')?.addEventListener('change',e=>{node.props.dosType=e.target.value;});
    inspector.querySelector('#prop-dosurl')?.addEventListener('input',e=>{node.props.dosUrl=e.target.value.trim();});

    inspector.querySelector('#prop-br')?.addEventListener('change',e=>{node.props.brightness=clamp(+e.target.value||0,0,100);});
    inspector.querySelector('#prop-scale')?.addEventListener('change',e=>{node.props.scale=clamp(+e.target.value||1,0.5,2.0);});
    inspector.querySelector('#prop-test')?.addEventListener('change',e=>{node.props.test=(e.target.value==='true');});
    inspector.querySelector('#prop-scolor')?.addEventListener('change',e=>{node.props.color=e.target.value;});
  }

  /* ---------------- help modal ---------------- */
  const helpBtn=document.getElementById('btn-help');
  const helpBackdrop=document.getElementById('help-backdrop');
  const helpClose=document.getElementById('btn-help-close');
  helpBtn?.addEventListener('click',()=>{helpBackdrop.style.display='flex';});
  helpClose?.addEventListener('click',()=>{helpBackdrop.style.display='none';});

  /* ---------------- misc helpers ---------------- */
  function flashHint(text){
    const hint=document.querySelector('.hint'), old=hint.textContent;
    hint.textContent=text; hint.style.borderColor='var(--danger)'; hint.style.color='#b91c1c';
    setTimeout(()=>{hint.textContent=old; hint.style.borderColor='var(--border)'; hint.style.color='#374151';},1200);
  }

  /* ---------------- save/load/new ---------------- */
  document.getElementById('btn-new').addEventListener('click',()=>{
    CommandStack.push(()=>{Store.nodes.length=0; Store.cables.length=0; Store.selection.clear();},()=>{});
  });
  document.getElementById('btn-save').addEventListener('click',()=>{
    const data={nodes:Store.nodes,cables:Store.cables,pan:Store.pan,zoom:Store.zoom};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='wiring.json'; a.click(); URL.revokeObjectURL(a.href);
  });
  document.getElementById('file-load').addEventListener('change',(e)=>{
    const f=e.target.files?.[0]; if(!f) return;
    const reader=new FileReader(); reader.onload=()=>{
      try{
        const obj=JSON.parse(reader.result);
        CommandStack.push(()=>{Store.nodes=obj.nodes||[]; Store.cables=obj.cables||[]; Store.pan=obj.pan||{x:0,y:0}; Store.zoom=obj.zoom||1; Store.selection.clear(); Store.dirty=true;},()=>{});
      }catch(err){ flashHint('Invalid JSON'); }
    }; reader.readAsText(f);
  });

  /* ---------------- start ---------------- */
  requestAnimationFrame(tick);
})();
