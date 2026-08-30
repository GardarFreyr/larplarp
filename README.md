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

### Að breyta stöðunni

Opnaðu földu valmyndina, skrunaðu niður að **Reikningar**, skrifaðu nýja tölu í
reitinn **Staða (ISK)** hjá þeim reikningi sem þú vilt breyta og ýttu á **Vista**.
Skrifaðu bara tölustafi (`1067040`) — punktarnir bætast við sjálfkrafa.
Ráðstöfun fylgir stöðunni sjálfkrafa nema þú takir hakið af.

Þar er líka hægt að breyta:

- nafni notanda og „Til ráðstöfunar“
- heiti, reikningsnúmeri og ráðstöfun á hverjum reikningi
- hvort reikningur telst velta- eða sparireikningur
- bæta við nýjum reikningi eða eyða reikningi
- bæta við færslu á hvaða reikning sem er
- **Endurstilla allt** setur allt í upphaflegt horf

Allt vistast sjálfkrafa svo tölurnar haldast þótt appinu sé lokað.

## Skrár

| Skrá | Hlutverk |
|---|---|
| `index.html` | allt appið (HTML + CSS + JS) |
| `manifest.webmanifest` | gerir það að heimaskjá-appi |
| `icon-180.png`, `icon-512.png` | app-táknmynd |
| `bankareikningar.html` | gömul slóð, vísar á `index.html` |

Þetta er grín — ekki tengt neinum banka og engar raunverulegar upplýsingar.
