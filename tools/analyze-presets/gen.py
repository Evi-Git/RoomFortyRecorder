import os
import json, re, glob, datetime
specs=json.load(open(os.environ.get('OUT','specs.json')))
S=open(os.environ.get('WA_DIR','../WoWAnalyzer')+'/src/game/SPECS.ts').read()
specid=dict((k,int(v)) for k,v in re.findall(r"\n  ([A-Z_]+): \{\s*id: (\d+)",S))
talent_entries={}; by_id={}; by_name={}
for f in glob.glob(os.environ.get('WA_DIR','../WoWAnalyzer')+'/src/common/TALENTS/*.ts'):
    cls=f.split('/')[-1][:-3]
    t=open(f).read()
    for m in re.finditer(r"\n  ([A-Z0-9_]+): \{(.*?)\n  \},", t, re.S):
        body=m.group(2)
        im=re.search(r"\bid: (\d+)", body); nm=re.search(r"\bname: (['\"])((?:\\.|(?!\1).)*)\1", body)
        em=re.search(r"entryIds: \[([\d, ]*)\]", body)
        if not (im and em): continue
        ents=[int(e) for e in em.group(1).split(',') if e.strip()]
        talent_entries.setdefault(m.group(1),ents)
        by_id.setdefault(int(im.group(1)),ents)
        if nm: by_name.setdefault((cls,nm.group(2).replace("\\'","'")),ents)
HEALERS={65,105,256,257,264,270,1468}
KEEP={'ROTATIONAL','ROTATIONAL_AOE','COOLDOWNS','SEMI_DEFENSIVE','HEALER_DAMAGING_SPELL'}
out={}; notes={}
for path,v in specs.items():
    sid=specid.get(v['spec'] or '')
    if not sid: continue
    healer=sid in HEALERS
    ws=[{'id':'active','kind':'activeTime'},{'id':'breakdown','kind':'breakdown','metric':'healing' if healer else 'damage'}]
    if not healer: ws.append({'id':'waste','kind':'resourceWaste'})
    abil=[a for a in v['abilities'] if a['castEfficiency'] and a['category'] in KEEP]
    src='castEfficiency'
    if not abil:
        abil=[a for a in v['abilities'] if a['category']=='COOLDOWNS' and a['cooldown'] and a['cooldown'].get('s',0)>=30]
        src='cooldowns'
    seen=set()
    # cooldowns first, then rotational
    abil.sort(key=lambda a:(0 if a['category']=='COOLDOWNS' else 1))
    for a in abil:
        sp=a['spells'][0]
        if sp['name'] in seen: continue
        seen.add(sp['name'])
        w={'id':'ce-%d'%sp['id'],'kind':'castEfficiency','spell':{'name':sp['name'],'id':sp['id']}}
        cd=a['cooldown'] or {}
        if 's' in cd and re.fullmatch(r"\d+(\.\d+)?",cd['raw']): w['cooldown']=cd['s']
        if a['charges'] and a['charges']>1: w['charges']=a['charges']
        if a.get('recommended'): w['target']=a['recommended']
        cls=path.split('/')[0]
        ents=talent_entries.get(sp['key']) or by_id.get(sp['id']) or by_name.get((cls,sp['name']))
        if ents: w['talent']=ents
        elif a.get('talentGated') or sp['key'].endswith('_TALENT'): w['optional']=True
        ws.append(w)
    out[sid]=ws
    notes[sid]={'path':path,'patch':v['patch'],'sections':v['sections'],'source':src}
lines=['/**',
 ' * [RoomFortyRecorder] Logs → Analyze: starting widgets per spec (1.9.111).',
 ' *',
 ' * GENERATED from WoWAnalyzer (github.com/WoWAnalyzer/WoWAnalyzer, '+datetime.date.today().isoformat()+'):',
 ' * each spec\'s graded abilities (its Abilities module: cast efficiency',
 ' * suggestions, cooldowns, charges and recommended efficiency) and the',
 ' * talent entry IDs from its talent tables. Only facts (spell IDs, names,',
 ' * cooldowns) are taken. Regenerate rather than hand-edit; the guild',
 ' * preset (shared on the server) overrides these.',
 ' */',
 "import type { WidgetSpec } from './analyze';",'',
 '/** spec ID -> widgets. */',
 'export const SPEC_PRESETS: Record<number, WidgetSpec[]> = '+json.dumps(out,indent=2)+';','',
 "/** spec ID -> WoWAnalyzer's guide sections (shown as a hint), and patch. */",
 'export const SPEC_GUIDE: Record<number, { sections: string[]; patch: string | null }> = '+json.dumps({k:{'sections':n['sections'],'patch':n['patch']} for k,n in notes.items()},indent=2)+';','']
open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'../../src/renderer/logs/specPresets.ts'),'w').write('\n'.join(lines))
for k,n in sorted(notes.items(), key=lambda x:x[1]['path']):
    ce=[w for w in out[k] if w['kind']=='castEfficiency']
    print(f"{n['path']:26} {k:5} {n['source']:14} {len(ce):2} CE: "+', '.join(w['spell']['name']+('' if 'talent' in w else '*') for w in ce)[:150])
