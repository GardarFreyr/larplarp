# Larp Larp

Prakkara-app sem lítur út eins og bankaapp. Ein HTML-skrá, ekkert bakendi —
allar tölur eru geymdar í vafranum þínum (`localStorage`), ekkert fer neitt.

## Keyra

Opnaðu `index.html` — eða settu þetta á GitHub Pages og opnaðu slóðina í Safari í símanum.

Til að fá „alvöru app“-fílinginn: **Deila → Bæta við á heimaskjá**. Þá opnast það
í fullum skjá, án veffangastiku, með rauða merkinu sem app-táknmynd.

## Skjáir

1. **Splash** – rauða merkið á dökkbláum grunni.
2. **Samantekt** – forsíða með Veltureikningum, Sparireikningum og „Til ráðstöfunar“.
3. **Bankareikningar** – listi yfir alla reikninga (ýttu á reikning til að opna hann).
4. **Reikningur** – staða, ráðstöfun, leit og færslulisti.
5. **Millifæra** – gerfi-millifærsla með kennitölu og reikningsnúmeri.
6. **Kvittun** – „Greitt“ skjár með grænu haki, upphæð og tilvísunarnúmeri.
7. **Valmynd** – hamborgarahnappurinn efst til hægri.

## Millifæra (gerfi)

Ýttu á bláa **Millifæra** hnappinn á forsíðunni, eða **Millifærslur** í valmyndinni.

1. Veldu reikninginn sem á að greiða af (byrjar á þeim sem þú varst síðast að skoða).
2. Sláðu inn **kennitölu** (formast sjálfkrafa `000000-0000`), nafn móttakanda og
   **reikningsnúmer** í þremur reitum (`0133-26-012345`) — það stekkur sjálft á næsta reit.
3. Sláðu inn upphæð og skýringu og ýttu á **Millifæra**.
4. Það kemur stutt „Millifæri…“ bið og svo **Greitt**-skjárinn með grænu haki,
   upphæð, móttakanda, dagsetningu og tilvísunarnúmeri.

Upphæðin dregst sjálfkrafa af reikningnum og færslan birtist efst í færslulistanum
með nafni móttakandans. Viltu að tölurnar haldist óbreyttar? Slökktu á
**„Draga millifærslur af stöðunni“** í földu valmyndinni.

## Falda valmyndin

Þrjár leiðir, allar á **rauða merkinu** efst í horninu:

- **Haltu inni** merkinu í ~0,7 sek.
- eða **ýttu 5 sinnum** hratt á það.
- eða opnaðu slóðina með `#stillingar` aftast.

Valmyndin er í þremur flipum og **allt vistast jafnóðum** — engin þörf á að ýta á
vista, `Loka` lokar bara blaðinu.

### Reikningar

Hver reikningur er samanbrotinn: heiti, reikningsnúmer og staða í einni línu.
Ýttu á hann til að opna hann.

- **Staða (ISK)** – skrifaðu nýja tölu, punktarnir koma sjálfir þegar þú ferð úr reitnum.
- **Flýtihnappar** `+10þ` `+100þ` `+1m` `×10` `0` – breyta stöðunni með einum smelli.
- Heiti reiknings, reikningsnúmer og velta- eða sparireikningur.
- **Eyða reikningi**, og `+ Nýr reikningur` neðst.

### Nöfn

- **Nafn notanda** – skiptu um nafn og það breytist **alls staðar**: í öllum færslum
  sem eru á þig, í reikningsheitum (`Garðar sparibanki` verður `Sigríður sparibanki`)
  og efst á reikningalistanum. Þannig geta vinir þínir sett sitt eigið nafn inn.
- **Til ráðstöfunar**, hakið **Ráðstöfun fylgir stöðunni** og hakið
  **Draga millifærslur af stöðunni**.
- **Endurstilla allt** setur allt í upphaflegt horf.

### Færslur

Veldu reikning, sjáðu allar færslurnar hans og eyddu þeim með rauða krossinum.
Neðst bætir þú við nýrri færslu — flýtihnapparnir **Nafn notanda**,
**Launagreiðsla** og **Millifært** fylla nafnið út. Dagsetning er í dag ef reiturinn
er tómur, og mínus fyrir framan upphæð gerir hana að úttekt (`-2000`).

## Skrár

| Skrá | Hlutverk |
|---|---|
| `index.html` | allt appið (HTML + CSS + JS) |
| `manifest.webmanifest` | gerir það að heimaskjá-appi |
| `icon-180.png`, `icon-512.png` | app-táknmynd |
| `bankareikningar.html` | gömul slóð, vísar á `index.html` |

Þetta er grín — ekki tengt neinum banka og engar raunverulegar upplýsingar.
