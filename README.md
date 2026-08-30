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
5. **Valmynd** – hamborgarahnappurinn efst til hægri.

## Falda valmyndin

Þrjár leiðir, allar á **rauða merkinu** efst í horninu:

- **Haltu inni** merkinu í ~0,7 sek.
- eða **ýttu 5 sinnum** hratt á það.
- eða opnaðu slóðina með `#stillingar` aftast.

Þar er hægt að breyta:

- nafni notanda og „Til ráðstöfunar“
- heiti, reikningsnúmeri, **stöðu og ráðstöfun á hverjum reikningi**
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
