import os, re, json, glob, sys
ROOT=os.environ.get('WA_DIR','../WoWAnalyzer')+'/src'
R=ROOT+'/analysis/retail'
# spell table: KEY -> (id, name), from common SPELLS/TALENTS and any spec-local constants
spell={}
def load_table(path, prefix=''):
    s=open(path,encoding='utf8',errors='ignore').read()
    for m in re.finditer(r"\n\s+([A-Z][A-Z0-9_]+):\s*\{\s*id:\s*(\d+),\s*name:\s*(['\"])(.*?)\3", s):
        spell.setdefault(prefix+m.group(1),(int(m.group(2)),m.group(4).replace("\\'","'")))
for f in glob.glob(ROOT+'/common/SPELLS/**/*.ts',recursive=True)+glob.glob(ROOT+'/common/TALENTS/*.ts'):
    load_table(f)
for f in glob.glob(R+'/**/*.ts',recursive=True):
    if re.search(r'SPELLS|spells|constants|TALENTS',os.path.basename(f)): load_table(f)

def keys_in(text):
    out=[]
    for m in re.finditer(r"\b(?:SPELLS|TALENTS|TALENTS_[A-Z_]+|[A-Z_]*SPELLS)\.([A-Z][A-Z0-9_]+)",text):
        k=m.group(1)
        if k in spell and k not in out: out.append(k)
    return out
def ref(k): i,n=spell[k]; return {'name':n,'id':i,'key':k}

CAT=re.compile(r"SPELL_CATEGORY\.([A-Z_]+)")
def abilities(spec_dir, shared_dir):
    files=[f for d in (spec_dir,shared_dir) if d for f in glob.glob(d+'/**/Abilities.ts*',recursive=True)]
    out=[]
    for f in files:
        s=open(f).read()
        # split on top-level "{\n  spell:" entries
        for m in re.finditer(r"\{\s*spell:", s):
            start=m.start(); depth=0; j=start
            while j < len(s):
                c=s[j]
                if c=='{': depth+=1
                elif c=='}':
                    depth-=1
                    if depth==0: break
                j+=1
            obj=s[start:j+1]
            sm=re.match(r"\{\s*spell:\s*(\[[^\]]*\]|[^,\n]+),", obj)
            if not sm: continue
            body=obj[sm.end():]
            ks=keys_in(sm.group(1))
            if not ks: continue
            cat=CAT.search(body); cat=cat.group(1) if cat else None
            cd=None
            cm=re.search(r"\bcooldown:\s*([^\n]+)",body)
            if cm:
                v=cm.group(1).strip().rstrip(',')
                n=(re.fullmatch(r"(\d+(?:\.\d+)?)",v) or re.fullmatch(r"\w*[hH]asted\w*\((\d+(?:\.\d+)?)\)",v)
                   or re.search(r"=>\s*(\d+(?:\.\d+)?)\s*/\s*\(1\s*\+\s*haste\)",v) or re.fullmatch(r"(\d+(?:\.\d+)?)\s*/\s*\(1\s*\+\s*haste\)",v))
                cd={'raw':v[:60]}
                if n: cd['s']=float(n.group(1))
            ch=re.search(r"\bcharges:\s*(\d+)\b",body)
            ce=re.search(r"castEfficiency:\s*\{(.*?)\n\s*\}",body,re.S)
            sug=bool(ce and re.search(r"suggestion:\s*true",ce.group(1)))
            rec=re.search(r"recommendedEfficiency:\s*([\d.]+)",ce.group(1)) if ce else None
            out.append({'spells':[ref(k) for k in ks],'category':cat,'cooldown':cd,'charges':int(ch.group(1)) if ch else None,
                        'castEfficiency':sug,'recommended':float(rec.group(1)) if rec else None,'talentGated':'hasTalent' in body or 'enabled' in body})
    return out

def parser_modules(spec_dir):
    """modules key -> source file"""
    out={}
    for f in glob.glob(spec_dir+'/CombatLogParser.ts*'):
        s=open(f).read()
        imports={}
        for m in re.finditer(r"import\s+(\w+)(?:,\s*\{[^}]*\})?\s+from\s+'([^']+)'",s):
            imports[m.group(1)]=m.group(2)
        for m in re.finditer(r"import\s+\{([^}]*)\}\s+from\s+'([^']+)'",s):
            for n in m.group(1).split(','):
                n=n.strip().split(' as ')[-1].strip()
                if n: imports[n]=m.group(2)
        mm=re.search(r"specModules\s*=\s*\{(.*?)\n\s*\};",s,re.S)
        if mm:
            for m in re.finditer(r"(\w+):\s*(\w+)",mm.group(1)):
                out[m.group(1)]=imports.get(m.group(2))
    return out

def resolve(path, base):
    if not path: return None
    if path.startswith('.'): p=os.path.normpath(os.path.join(base,path))
    elif path.startswith('analysis/'): p=ROOT+'/'+path
    else: return None
    for ext in ('','.ts','.tsx','/index.ts','/index.tsx'):
        if os.path.isfile(p+ext): return p+ext
    return None

def guide(spec_dir):
    cls_dir=os.path.dirname(spec_dir)
    entries=[f for f in [spec_dir+'/Guide.tsx',spec_dir+'/modules/guide/Guide.tsx',spec_dir+'/guide/Guide.tsx',spec_dir+'/modules/guide/index.tsx',spec_dir+'/guide/index.tsx'] if os.path.isfile(f)]
    seen=[]; stack=[(f,0) for f in entries]
    while stack:
        f,dep=stack.pop(0)
        if f in seen: continue
        seen.append(f)
        if dep>=4: continue
        t=open(f).read()
        for m in re.finditer(r"from\s+'(\.[^']+|analysis/retail/[^']+)'",t):
            p=resolve(m.group(1),os.path.dirname(f))
            if p and p.endswith('.tsx') and p.startswith(cls_dir) and p not in seen: stack.append((p,dep+1))
    sections=[]; mods=[]; text=''
    for f in seen:
        s=open(f).read(); text+=s
        for m in re.finditer(r"<Section\s+title=(?:\{\s*(?:t\(\s*\{[^}]*message:\s*|msg`|t`|defineMessage\(\{[^}]*message:\s*)?)?['\"`]([^'\"`]+)",s):
            if m.group(1).strip() not in sections: sections.append(m.group(1).strip())
        for m in re.finditer(r"modules\.(\w+)",s):
            if m.group(1) not in mods: mods.append(m.group(1))
    return seen, sections, mods, text

specs={}
for cls in sorted(os.listdir(R)):
    for sp in sorted(os.listdir(f'{R}/{cls}')):
        if sp=='shared' or not os.path.isdir(f'{R}/{cls}/{sp}'): continue
        d=f'{R}/{cls}/{sp}'; shared=f'{R}/{cls}/shared' if os.path.isdir(f'{R}/{cls}/shared') else None
        cfg=open(d+'/CONFIG.tsx').read() if os.path.exists(d+'/CONFIG.tsx') else ''
        specid=re.search(r"SPECS\.([A-Z_]+)",cfg)
        files,secs,mods,gtext=guide(d)
        pm=parser_modules(d)
        modinfo={}
        for k in mods:
            f=resolve(pm.get(k), d)
            if f:
                t=open(f).read()
                modinfo[k]={'file':os.path.relpath(f,R),'spells':[ref(x) for x in keys_in(t)][:12],
                    'hints':sorted(set(w for w in ['uptime','wasted','overwrit','consum','proc','buff','cast efficiency','castEfficiency','window','during','resource','overcap','capped'] if w.lower() in t.lower()))}
            else: modinfo[k]={'file':None}
        specs[f'{cls}/{sp}']={'spec':specid.group(1) if specid else None,'patch':(re.search(r"patchCompatibility:\s*'([^']+)'",cfg) or [None,None])[1],
            'guideFiles':[os.path.relpath(f,R) for f in files],'sections':secs,'modules':modinfo,
            'guideSpells':[ref(x) for x in keys_in(gtext)],
            'abilities':abilities(d,shared)}
json.dump(specs,open(os.environ.get('OUT','specs.json'),'w'),indent=1)
print(len(spell),'spells;',len(specs),'specs')
for k,v in specs.items():
    print(f"{k:28} sec={len(v['sections']):2} mods={len(v['modules']):2} resolved={sum(1 for m in v['modules'].values() if m.get('file')):2} abil={len(v['abilities']):3} ce={sum(a['castEfficiency'] for a in v['abilities']):2}")
