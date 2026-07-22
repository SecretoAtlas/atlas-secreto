import json,re,unicodedata,hashlib,os,datetime,shutil
root=os.path.abspath(os.path.join(os.path.dirname(__file__),'..'))
cat=f'{root}/data/catalog'
P=json.load(open(f'{cat}/products.json',encoding='utf-8'))['products']
O=json.load(open(f'{cat}/offers.json',encoding='utf-8'))['offers']
offers_by={o['productId']:o for o in O}
COLORS=['beige','gris','antracita','negro','negra','blanco','blanca','crema','marrón','marron','verde','azul','rojo','rosa','amarillo','naranja','taupe','cognac','plateado','plata','dorado']
ORIENT=['izquierda','derecha','izquierdo','derecho']

def norm(s):
 s=unicodedata.normalize('NFKD',s or '').encode('ascii','ignore').decode().lower()
 s=re.sub(r'\b\d+(?:[.,]\d+)?\s*(?:cm|mm|m|plazas?|piezas?)\b',' ',s)
 s=re.sub(r'\b(?:'+('|'.join(map(re.escape,COLORS+ORIENT)))+r')\b',' ',s)
 s=re.sub(r'[^a-z0-9]+',' ',s)
 return ' '.join(s.split())

def attr(title, words):
 t=title.lower()
 return next((w for w in words if re.search(r'\b'+re.escape(w)+r'\b',t)),None)

groups={}; hidden=[]
for p in P:
 o=offers_by.get(p['id'])
 reason=None
 if not o: reason='sin_oferta'
 elif not p.get('images'): reason='sin_imagen'
 elif not o.get('affiliateUrl'): reason='sin_enlace_afiliado'
 elif not isinstance(o.get('price'),(int,float)) or o.get('price',0)<=0: reason='precio_invalido'
 if reason:
  hidden.append({'productId':p['id'],'reason':reason}); continue
 model=(p.get('model') or '').strip()
 key='|'.join([norm(p.get('brand') or 'sin marca'),norm(p.get('category') or ''),norm(model) if model else norm(p['title'])])
 groups.setdefault(key,[]).append((p,o))

families=[]
for key,items in groups.items():
 # conservative split if same model but wildly different product types
 bytype={}
 for p,o in items:
  typ=norm((p.get('attributes') or {}).get('productType') or p.get('category') or '')
  bytype.setdefault(typ,[]).append((p,o))
 for typ,subs in bytype.items():
  ps=[x[0] for x in subs]; os_=[x[1] for x in subs]
  rep=sorted(subs,key=lambda x:(x[1].get('availability')!='in_stock', -len(x[0].get('images') or []), x[1].get('price',10**9)))[0][0]
  fid='fam-'+hashlib.sha1((key+'|'+typ).encode()).hexdigest()[:12]
  variants=[]
  for p,o in sorted(subs,key=lambda x:x[1].get('price',10**9)):
   title=p['title']; a=p.get('attributes') or {}; v=p.get('variant') or {}
   variants.append({
    'id':p['id'],'title':title,'color':v.get('color') or attr(title,COLORS),
    'orientation':v.get('orientation') or attr(title,ORIENT),
    'dimensions':a.get('dimensions'),'material':a.get('specifications'),
    'images':p.get('images',[])[:5], 'offerId':o['id'],'price':o['price'],
    'previousPrice':o.get('previousPrice'),'shippingCost':o.get('shippingCost'),
    'availability':o.get('availability'),'affiliateUrl':o['affiliateUrl'],'landingUrl':o.get('landingUrl')
   })
  prices=[v['price'] for v in variants]
  score=min(9.8,6.5+(1 if all(v['availability']=='in_stock' for v in variants) else .3)+min(1,len(rep.get('images',[]))*.15)+(.6 if len(variants)>1 else .2))
  families.append({
   'id':fid,'slug':re.sub(r'[^a-z0-9]+','-',norm(f"{rep.get('brand','')} {rep.get('model') or rep['title']}" )).strip('-')[:90],
   'title': f"{rep.get('brand','')} {rep.get('model','')}".strip() if rep.get('model') else rep['title'],
   'brand':rep.get('brand'),'model':rep.get('model'),'category':rep.get('category'),'categories':rep.get('categories',[]),
   'description':rep.get('description'),'image':(rep.get('images') or [None])[0],
   'images':rep.get('images',[])[:5],'minPrice':min(prices),'maxPrice':max(prices),
   'variantCount':len(variants),'secretScore':round(score,1),'variants':variants
  })

families.sort(key=lambda x:(x['category'] or '',x['title']))
report={
 'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'sourceProducts':len(P),'sourceOffers':len(O),'families':len(families),
 'variants':sum(f['variantCount'] for f in families),'hidden':len(hidden),
 'sofaProducts':sum(1 for p in P if p.get('category')=='Sofás'),
 'sofaFamilies':sum(1 for f in families if f.get('category')=='Sofás'),
 'largestFamilies':sorted([{'id':f['id'],'title':f['title'],'variants':f['variantCount']} for f in families],key=lambda x:-x['variants'])[:20],
 'policy':'B como base con selección C moderada; agrupación conservadora por marca, categoría, modelo y tipo.'
}
json.dump({'schemaVersion':2,'generatedAt':report['generatedAt'],'families':families},open(f'{cat}/families.json','w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
json.dump({'schemaVersion':2,'report':report,'hiddenProducts':hidden},open(f'{cat}/family-grouping-report.json','w',encoding='utf-8'),ensure_ascii=False,indent=2)
print(json.dumps(report,ensure_ascii=False,indent=2))
