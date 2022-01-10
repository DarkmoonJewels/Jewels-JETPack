"use strict";

function sortOffersByID(a, b) {
  return a.intId - b.intId;
}

function sortOffersByRating(a, b) {
  return a.user.rating - b.user.rating;
}

function sortOffersByName(a, b) {
  // @TODO: Get localized item names
  try {
    let aa = helper_f.getItem(a._id)[1]._name;
    let bb = helper_f.getItem(b._id)[1]._name;

    aa = aa.substring(aa.indexOf("_") + 1);
    bb = bb.substring(bb.indexOf("_") + 1);

    return aa.localeCompare(bb);
  } catch (e) {
    return 0;
  }
}

function sortOffersByPrice(a, b) {
  return a.requirements[0].count - b.requirements[0].count;
}

function sortOffersByPriceSummaryCost(a, b) {
  return a.summaryCost - b.summaryCost;
}

function sortOffersByExpiry(a, b) {
  return a.endTime - b.endTime;
}

function sortOffers(request, offers) {
  // Sort results
  switch (request.sortType) {
    case 0: // ID
      offers.sort(sortOffersByID);
      break;

    case 3: // Merchant (rating)
      offers.sort(sortOffersByRating);
      break;

    case 4: // Offer (title)
      offers.sort(sortOffersByName);
      break;

    case 5: // Price
      if (request.offerOwnerType == 1) {
        offers.sort(sortOffersByPriceSummaryCost);
      } else {
        offers.sort(sortOffersByPrice);
      }
      break;

    case 6: // Expires in
      offers.sort(sortOffersByExpiry);
      break;
  }

  // 0=ASC 1=DESC
  if (request.sortDirection === 1) {
    offers.reverse();
  }

  return offers;
}

/* Scans a given slot type for filters and returns them as a Set */
function getFilters(item, slot) {
  let result = new Set();
  if (slot in item._props && item._props[slot].length) {
    for (let sub of item._props[slot]) {
      if ("_props" in sub && "filters" in sub._props) {
        for (let filter of sub._props.filters) {
          for (let f of filter.Filter) {
            result.add(f);
          }
        }
      }
    }
  }

  return result;
}

/* Like getFilters but breaks early and return true if id is found in filters */
function isInFilter(id, item, slot) {
  if (slot in item._props && item._props[slot].length) {
    for (let sub of item._props[slot]) {
      if ("_props" in sub && "filters" in sub._props) {
        for (let filter of sub._props.filters) {
          if (filter.Filter.includes(id)) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

/* Because of presets, categories are not always 1 */
function countCategories(response) {
  let categ = {};

  for (let offer of response.offers) {
    let item = offer.items[0]; // only the first item can have presets
    categ[item._tpl] = categ[item._tpl] || 0;
    categ[item._tpl]++;
  }
  // not in search mode, add back non-weapon items
  for (let c in response.categories) {
    if (!categ[c]) {
      categ[c] = 1;
    }
  }

  response.categories = categ;
}

function getOffers(sessionID, request) {
  //if its traders items, just a placeholder it will be handled differently later
  if (request.offerOwnerType === 1) {
    return getOffersFromTraders(sessionID, request);
  }

  let response = {
    categories: {},
    offers: [],
    offersCount: 10,
    selectedCategory: "5b5f78dc86f77409407a7f8e",
  };
  let itemsToAdd = [];
  let offers = [];

  if (!request.linkedSearchId && !request.neededSearchId) {
    response.categories = trader_f.handler.getAssort(sessionID, "ragfair").loyal_level_items;
  }

  if (request.buildCount) {
    // Case: weapon builds
    itemsToAdd = itemsToAdd.concat(Object.keys(request.buildItems));
  } else {
    // Case: search
    if (request.linkedSearchId) {
      itemsToAdd = getLinkedSearchList(request.linkedSearchId);
    } else if (request.neededSearchId) {
      itemsToAdd = getNeededSearchList(request.neededSearchId);
    }

    // Case: category
    if (request.handbookId) {
      let handbook = getCategoryList(request.handbookId);

      if (itemsToAdd.length) {
        itemsToAdd = helper_f.arrayIntersect(itemsToAdd, handbook);
      } else {
        itemsToAdd = handbook;
      }
    }
  }

  for (let item of itemsToAdd) {
    if (request.buildCount) {
      let itemOffers = offers.concat(createOffer(item, request.onlyFunctional, request.buildCount)).filter((o) => o.items[0]._tpl == item).sort(sortOffersByPrice);
      let remainingCount = request.buildCount * request.buildItems[item];
      while (remainingCount > 0 && itemOffers.length > 0) {
        offers.push(itemOffers[0]);
        remainingCount -= 1;
        itemOffers[0].items[0].upd.StackObjectsCount -= 1;

        if (itemOffers[0].items[0].upd.StackObjectsCount == 0) {
          itemOffers.splice(0, 1);
        }
      }
    } else {
      offers = offers.concat(createOffer(item, request.onlyFunctional, request.buildCount === 0));
    }
  }

  // merge trader offers with player offers display offers is set to 'ALL'
  if (request.offerOwnerType === 0) {
    const traderOffers = getOffersFromTraders(sessionID, request).offers;
    offers = [...offers, ...traderOffers];
  }

  response.offers = sortOffers(request, offers);
  countCategories(response);
  return response;
}

function getOffersFromTraders(sessionID, request) {
  let jsonToReturn = fileIO.readParsed(db.user.cache.ragfair_offers);
  let offersFilters = []; //this is an array of item tpl who filter only items to show

  jsonToReturn.categories = {};
  for (let offerC of jsonToReturn.offers) {
    jsonToReturn.categories[offerC.items[0]._tpl] = 1;
  }

  if (request.buildCount) {
    // Case: weapon builds
    offersFilters = Object.keys(request.buildItems);
    jsonToReturn = fillCatagories(jsonToReturn, offersFilters);
  } else {
    // Case: search
    if (request.linkedSearchId) {
      //offersFilters.concat( getLinkedSearchList(request.linkedSearchId) );
      offersFilters = [...offersFilters, ...getLinkedSearchList(request.linkedSearchId), ];
      jsonToReturn = fillCatagories(jsonToReturn, offersFilters);
    } else if (request.neededSearchId) {
      offersFilters = [...offersFilters, ...getNeededSearchList(request.neededSearchId), ];
      jsonToReturn = fillCatagories(jsonToReturn, offersFilters);
    }

    if (request.removeBartering == true) {
      jsonToReturn = removeBarterOffers(jsonToReturn);
      jsonToReturn = fillCatagories(jsonToReturn, offersFilters);
    }

    // Case: category
    if (request.handbookId) {
      let handbookList = getCategoryList(request.handbookId);

      if (offersFilters.length) {
        offersFilters = helper_f.arrayIntersect(offersFilters, handbookList);
      } else {
        offersFilters = handbookList;
      }
    }
  }

  let offersToKeep = [];
  for (let offer in jsonToReturn.offers) {
    for (let tplTokeep of offersFilters) {
      if (jsonToReturn.offers[offer].items[0]._tpl == tplTokeep) {
        jsonToReturn.offers[offer].summaryCost = calculateCost(jsonToReturn.offers[offer].requirements);
        // check if offer is really available, removes any quest locked items not in current assort of a trader
        let tmpOffer = jsonToReturn.offers[offer];
        let traderId = tmpOffer.user.id;
        let traderAssort = trader_f.handler.getAssort(sessionID, traderId).items;
        let keepItem = false; // for testing
        for (let item of traderAssort) {
          if (item._id === tmpOffer.root) {
            offersToKeep.push(jsonToReturn.offers[offer]);
            keepItem = true;
            break;
          }
        }
      }
    }
  }
  jsonToReturn.offers = offersToKeep;
  jsonToReturn.offers = sortOffers(request, jsonToReturn.offers);

  return jsonToReturn;
}

function fillCatagories(response, filters) {
  response.categories = {};
  for (let filter of filters) {
    response.categories[filter] = 1;
  }

  return response;
}

function removeBarterOffers(response) {
  let override = [];
  for (let offer of response.offers) {
    if (helper_f.isMoneyTpl(offer.requirements[0]._tpl) == true) {
      override.push(offer);
    }
  }
  response.offers = override;
  return response;
}

function calculateCost(barter_scheme) {
  //theorical , not tested not implemented
  let summaryCost = 0;

  for (let barter of barter_scheme) {
    summaryCost += helper_f.getTemplatePrice(barter._tpl) * barter.count;
  }

  return Math.round(summaryCost);
}

function getLinkedSearchList(linkedSearchId) {
  let item = global._database.items[linkedSearchId];
  // merging all possible filters without duplicates
  let result = new Set([
    ...getFilters(item, "Slots"),
    ...getFilters(item, "Chambers"),
    ...getFilters(item, "Cartridges"),
  ]);

  return Array.from(result);
}

function getNeededSearchList(neededSearchId) {
  let result = [];

  for (let item of Object.values(global._database.items)) {
    if (isInFilter(neededSearchId, item, "Slots") || isInFilter(neededSearchId, item, "Chambers") || isInFilter(neededSearchId, item, "Cartridges")) {
      result.push(item._id);
    }
  }

  return result;
}

function getCategoryList(handbookId) {
  let result = [];

  // if its "mods" great-parent category, do double recursive loop
  if (handbookId === "5b5f71a686f77447ed5636ab") {
    for (let categ2 of helper_f.childrenCategories(handbookId)) {
      for (let categ3 of helper_f.childrenCategories(categ2)) {
        result = result.concat(helper_f.templatesWithParent(categ3));
      }
    }
  } else {
    if (helper_f.isCategory(handbookId)) {
      // list all item of the category
      result = result.concat(helper_f.templatesWithParent(handbookId));

      for (let categ of helper_f.childrenCategories(handbookId)) {
        result = result.concat(helper_f.templatesWithParent(categ));
      }
    } else {
      // its a specific item searched then
      result.push(handbookId);
    }
  }

  return result;
}

function createOffer(template, onlyFunc, usePresets = true) {
  // Some slot filters reference bad items
  if (!(template in global._database.items)) {
    logger.logWarning(`Item ${template} does not exist`);
    return [];
  }

  // Remove items that don't exist in assort
  if (Object.values(global._database.traders.ragfair.assort.items).filter(tItem => tItem._tpl == template || tItem._id == template).length == 0) {
    logger.logWarning(`Item ${template} does not exist in ragfair assort, ignoring...`);
    return [];
  }

  let offerBase = fileIO.readParsed(db.base.fleaOffer);
  let offers = [];
  let time = Math.floor(new Date().getTime() / 1000);

  // Preset
  var step;
  for (step = 0; step < 1 * Math.ceil(Math.random() * 30); step++) {
    if (usePresets && preset_f.handler.hasPreset(template)) {
      let presets = helper_f.clone(preset_f.handler.getPresets(template));

      for (let p of presets) {
        let offer = helper_f.clone(offerBase);
        let mods = p._items;
        let rub = 0;

        for (let it of mods) {
          rub += helper_f.getTemplatePrice(it._tpl);
        }

        mods[0].upd = mods[0].upd || {}; // append the stack count
        mods[0].upd.StackObjectsCount = utility.getRandomInt(_database.gameplay.ragfair.dynamic.stack.min, _database.gameplay.ragfair.dynamic.stack.max);

        offer._id = p._id; // The offer's id is now the preset's id
        offer.root = mods[0]._id; // Sets the main part of the weapon
        offer.items = mods;
        offer.intId = 1 * Math.ceil(Math.random() * 99999999);
        offerBase.user.nickname = fleaName();
        offerBase.user.rating = Math.random() * (_database.gameplay.ragfair.dynamic.rating.max - _database.gameplay.ragfair.dynamic.rating.min) + _database.gameplay.ragfair.dynamic.rating.min;
        offerBase.user.isRatingGrowing = Math.random() < 0.5;
        offer.requirements[0].count = Math.round(rub + Math.ceil(Math.random() * 10000));
        offerBase.startTime = time;
        offerBase.endTime = Math.round(offerBase.startTime + utility.getRandomInt(_database.gameplay.ragfair.dynamic.endTime.min, _database.gameplay.ragfair.dynamic.endTime.max) * 60);
        offers.push(offer);
      }
    }
  }

  // Single item
  var step;
  for (step = 0; step < 1 * Math.ceil(Math.random() * 30); step++) {
    if (!preset_f.handler.hasPreset(template) || !onlyFunc) {
      let condMult = Math.random() * (_database.gameplay.ragfair.dynamic.condition.max - _database.gameplay.ragfair.dynamic.condition.min) + _database.gameplay.ragfair.dynamic.condition.min;
      if (offerBase.items[0].upd && offerBase.items[0].upd.Key && offerBase.items[0].upd.Key.NumberOfUsages) {
        offerBase.items[0].upd.Key.NumberOfUsages *= condMult;
      }

      if (offerBase.items[0].upd && offerBase.items[0].upd.Repairable) {
        offerBase.items[0].upd.Repairable.Durability *= condMult;
      }

      if (offerBase.items[0].upd && offerBase.items[0].upd.MedKit) {
        offerBase.items[0].upd.MedKit.HpResource *= condMult;
      }

      let rubPrice = Math.round(helper_f.getTemplatePrice(template) + Math.ceil(Math.random() * 10000));
      offerBase = helper_f.clone(offerBase);
      offerBase.intId = 1 * Math.ceil(Math.random() * 99999999);
      offerBase._id = template;
      offerBase.user.nickname = fleaName();
      offerBase.user.rating = Math.random() * (_database.gameplay.ragfair.dynamic.rating.max - _database.gameplay.ragfair.dynamic.rating.min) + _database.gameplay.ragfair.dynamic.rating.min;
      offerBase.user.isRatingGrowing = Math.random() < 0.5;
      offerBase.items[0]._tpl = template;
      offerBase.items[0].upd.StackObjectsCount = stackCount(template);
      offerBase.itemsCost = rubPrice;
      offerBase.requirements[0].count = rubPrice;
      offerBase.requirementsCost = rubPrice;
      offerBase.summaryCost = rubPrice;
      offerBase.startTime = time;
      offerBase.endTime = Math.round(offerBase.startTime + utility.getRandomInt(_database.gameplay.ragfair.dynamic.endTime.min, _database.gameplay.ragfair.dynamic.endTime.max) * 60);
      offers.push(offerBase);
    }
  }

  return offers;
}

function fleaName() {
  let namesList = fileIO.readParsed(db.base.fleaName);
  var randNamePos = Math.floor(Math.random() * namesList.length);
  var randName = namesList[randNamePos];
  return randName;
}

function stackCount(template) {
  var stack;
  for (let itemNode in _database.items) {
    if (_database.items[itemNode]._props.ammoType === "bullet" && _database.items[itemNode]._id === template) {
      stack = Math.floor(Math.random() * (77 - 1)) + 1; //Math.floor(Math.random(200));
    }

    if (_database.items[itemNode]._props.ammoType === "buckshot" && _database.items[itemNode]._id === template) {
      stack = Math.floor(Math.random() * (18 - 1)) + 1; //Math.floor(Math.random(200));
    }

    if (_database.items[itemNode]._parent === "5448f39d4bdc2d0a728b4568" && _database.items[itemNode]._id === template) {
      stack = Math.floor(Math.random() * (4 - 1)) + 1; //Math.floor(Math.random(200));
    }

    if (_database.items[itemNode]._parent === "5448f3a14bdc2d27728b4569" && _database.items[itemNode]._id === template) {
      stack = Math.floor(Math.random() * (3 - 1)) + 1; //Math.floor(Math.random(200));
    }

    if (_database.items[itemNode]._parent === "5448f3ac4bdc2dce718b4569" && _database.items[itemNode]._id === template) {
      stack = Math.floor(Math.random() * (3 - 1)) + 1; //Math.floor(Math.random(200));
    }
  }
  return stack;
}

function itemMarKetPrice(info, sessionId) {
  let response = {
    avg: 0,
    min: 0,
    max: 0,
  };
  try {
    const ragfairScheme = global._database.traders["ragfair"].assort.barter_scheme[info.templateId];
    if (ragfairScheme && ragfairScheme[0] && ragfairScheme[0][0] && ragfairScheme[0][0]._tpl === helper_f.getCurrency("RUB")) {
      response.avg = ragfairScheme[0][0].count;
    }
  } catch (err) {
    logger.logError(`Could not fetch ragfair price for ${info.templateId}`);
  }
  return response;
}

function ragFairAddOffer(pmcData, body, sessionID) {
  let output = item_f.handler.getOutput();
  let foundItem = null;
  let itemsInOffer = [];
  let price = 0;
  let count = 0;
  let req = 0;
  let request = {};

  for (let sellItem of body.items) {
    for (let item of pmcData.Inventory.items) {
      // profile inventory, look into it if item exist
      let isThereSpace = sellItem.search(" ");
      let checkID = sellItem;

      if (isThereSpace !== -1) {
        checkID = checkID.substr(0, isThereSpace);
      }

      // item found
      if (item._id === checkID) {
        let childItems = helper_f.findAndReturnChildrenAsItems(pmcData.Inventory.items, item._id);

        for (let child of childItems) {
          let i = helper_f.clone(child);
          delete i.location;

          if (child._id != item._id) {
            itemsInOffer.push(i);
          } else {
            i.parentId = "hideout";
            i.slotId = "hideout";

            count += i.upd.StackObjectsCount ? i.upd.StackObjectsCount : 1;

            if (foundItem) {
              let offerItem = itemsInOffer.find((i) => i._id == foundItem._id);
              if (!offerItem.upd) {
                offerItem.upd = {
                  StackObjectsCount: 2,
                };
              } else {
                offerItem.upd.StackObjectsCount = offerItem.upd.StackObjectsCount ? offerItem.upd.StackObjectsCount + 1 : 2;
              }
            } else {
              price = fetchItemFleaPrice(i._tpl);
              foundItem = i;
              itemsInOffer.push(i);
            }
          }
        }
      }
    }
  }

  for (let requirement of body.requirements) {
    let p = fetchItemFleaPrice(requirement._tpl);

    if (preset_f.handler.hasPreset(requirement._tpl) && requirement.onlyFunctional) {
      let presets = helper_f.clone(preset_f.handler.getPresets(requirement._tpl));
      p = 0;
      for (let mod of presets[0]._items) {
        p += fetchItemFleaPrice(mod._tpl);
      }
    }

    req += p * requirement.count;
  }

  if (body.sellInOnePiece) {
    req /= count;
  }

  // Pay commission
  let fee = CalculateTaxPrice(price, req, count, pmcData);

  request = {
    tid: "ragfair",
    Action: "TradingConfirm",
    scheme_items: [{
      id: helper_f.getCurrency("RUB"),
      count: fee,
    }, ],
  };

  if (!helper_f.payMoney(pmcData, request, sessionID)) {
    return helper_f.appendErrorToOutput(output, "Transaction failed: Couldn't pay commission fee");
  }

  // Remove items
  for (let sellItem of body.items) {
    for (let item of pmcData.Inventory.items) {
      // profile inventory, look into it if item exist
      let isThereSpace = sellItem.search(" ");
      let checkID = sellItem;

      if (isThereSpace !== -1) {
        checkID = checkID.substr(0, isThereSpace);
      }

      // item found
      if (item._id === checkID) {
        insurance_f.handler.remove(pmcData, checkID, sessionID);
        output = move_f.removeItem(pmcData, checkID, output, sessionID);
      }
    }
  }

  let sellChance = _database.gameplay.ragfair.sellBaseChance;

  if (req > price) {
    sellChance = Math.round(sellChance * (price / req / _database.gameplay.ragfair.overpricedDivider));
  }

  if (req < price) {
    sellChance = Math.round(sellChance * ((price / req) * _database.gameplay.ragfair.underPricedDivider));
  }

  if (foundItem.upd && foundItem.upd.Key && foundItem.upd.Key.NumberOfUsages) {
    let maxUsage = _database.items[foundItem._tpl]._props.MaximumNumberOfUsage;
    let remainingUsage = maxUsage - foundItem.upd.Key.NumberOfUsages;
    sellChance = Math.round(sellChance * (remainingUsage / maxUsage));
  }

  if (foundItem.upd && foundItem.upd.Repairable) {
    let maxDurability = _database.items[foundItem._tpl]._props.MaxDurability;
    let remainingDurabilty = foundItem.upd.Repairable.Durability;
    sellChance = Math.round(sellChance * (remainingDurabilty / maxDurability));
  }

  if (foundItem.upd && foundItem.upd.MedKit) {
    let maxHp = _database.items[foundItem._tpl]._props.MaxHpResource;
    let remainingHp = foundItem.upd.MedKit.HpResource;
    sellChance = Math.round(sellChance * (remainingHp / maxHp));
  }

  let success = false;
  let sellTime = 0;

  if (_database.gameplay.ragfair.alwaysSell || utility.getRandomInt(0, 99) < sellChance) {
    success = true;

    let x = 100 - Math.min(Math.max(sellChance, 0), 100);

    if (_database.gameplay.ragfair.instantSell) {
      sellTime = 1;
    } else {
      sellTime = utility.getTimestamp() + Math.round((x / 100) * _database.gameplay.ragfair.maxSellTime * 3600);

      if (x < 50) {
        sellTime += utility.getRandomInt(0, _database.gameplay.ragfair.maxRandomTime);
      } else {
        sellTime -= utility.getRandomInt(0, _database.gameplay.ragfair.maxRandomTime);
      }
    }
  }

  //Create offer
  let offer = {
    _id: utility.generateNewItemId(),
    intId: 1 * Math.ceil(Math.random() * 99999999),
    user: {
      id: pmcData._id,
      memberType: 0,
      nickname: pmcData.Info.Nickname,
      rating: pmcData.RagfairInfo.rating,
      isRatingGrowing: pmcData.RagfairInfo.isRatingGrowing,
      avatar: "/files/trader/avatar/unknown.jpg",
    },
    root: foundItem._id,
    rootTpl: foundItem._tpl,
    count: count,
    items: itemsInOffer,
    itemsCost: price,
    requirements: body.requirements,
    requirementsCost: req,
    summaryCost: req * count,
    sellInOnePiece: body.sellInOnePiece,
    startTime: utility.getTimestamp(),
    endTime: utility.getTimestamp() + 12 * 3600,
    sold: success,
    sellTime: sellTime,
    priority: false,
    loyaltyLevel: 1,
  };

  pmcData.RagfairInfo.offers.push(offer);
  return output;
}

function ragFairRemoveOffer(pmcData, info, sessionID) {
  let offers = pmcData.RagfairInfo.offers;

  for (let offer of offers) {
    if (offer._id === info.offerId) {
      offer.endTime = utility.getTimestamp() + 72;
      return item_f.handler.getOutput();
    }
  }

  return helper_f.appendErrorToOutput(item_f.handler.getOutput(), "Error: Offer not found");
}

function ragFairRenewOffer(pmcData, info, sessionID) {
  let offers = pmcData.RagfairInfo.offers;

  for (let offer of offers) {
    if (offer._id === info.offerId) {
      // Pay commission
      let fee = calculateCommission(offer.itemsCost, offer.requirementsCost, 1, pmcData);
      fee = fee * 0.1 * info.renewalTime;

      let request = {
        tid: "ragfair",
        Action: "TradingConfirm",
        scheme_items: [{
          id: "5449016a4bdc2d6f028b456f",
          count: fee,
        }, ],
      };

      if (!helper_f.payMoney(pmcData, request, sessionID)) {
        return helper_f.appendErrorToOutput(output, "Transaction failed: Couldn't pay commission fee");
      }

      offer.endTime += info.renewalTime * 3600;
      return item_f.handler.getOutput();
    }
  }

  return helper_f.appendErrorToOutput(item_f.handler.getOutput(), "Error: Offer not found");
}

function fetchItemFleaPrice(tpl) {
  return Math.round(getPrice(tpl) * _database.gameplay.ragfair.priceMultiplier);
}

function getPrice(id) {
  _database.templates.avgPrices = fileIO.readParsed(db.templates.avgPrices);
  return _database.templates.avgPrices[id] ? _database.templates.avgPrices[id] : helper_f.getTemplatePrice(id);
}

function CalculateTaxPrice(price, req, count, pmcData) {
  let powerOffer = Math.log10(price / req);
  let powerReq = Math.log10(req / price);

  if (powerReq >= powerOffer) {
    powerReq = Math.pow(powerReq, 1.08);
  } else {
    powerOffer = Math.pow(powerOffer, 1.08);
  }

  let fee = price * 0.05 * Math.pow(4, powerOffer) * count + req * 0.05 * Math.pow(4, powerReq) * count;

  let intelCenterDiscount = 0;
  for (const area of pmcData.Hideout.Areas) {
    if (area.type === 11) {
      if (area.level === 3) {
        intelCenterDiscount = 30;
      }
    }
  }

  return Math.round(fee - (fee * intelCenterDiscount) / 100);
}

function processOffers(sessionID, count) {
  let pmcData = profile_f.handler.getPmcProfile(sessionID);
  let offers = pmcData.RagfairInfo.offers;
  let i = offers.length;
  let time = utility.getTimestamp();

  while (i-- > 0) {
    let offer = offers[i];

    // Remove expired offer
    if (time >= offer.endTime) {
      let messageContent = {
        templateId: "5bdac06e86f774296f5a19c5",
        type: 13,
        maxStorageTime: _database.gameplay.other.RedeemTime * 3600,
      };

      let returnItems = [];
      for (let item of offer.items) {
        let itemInfo = _database.items[item._tpl]._props;
        let remaining = item.upd.StackObjectsCount;

        while (remaining > 0) {
          if (itemInfo.StackMaxSize == 1) {
            let i = helper_f.clone(item);
            i._id = utility.generateNewItemId();
            delete i.upd.StackObjectsCount;
            returnItems.push(i);
            remaining--;
            continue;
          }

          if (remaining > itemInfo.StackMaxSize) {
            let i = helper_f.clone(item);
            i._id = utility.generateNewItemId();
            i.upd.StackObjectsCount = itemInfo.StackMaxSize;
            returnItems.push(i);
            remaining -= itemInfo.StackMaxSize;
          } else {
            let i = helper_f.clone(item);
            i._id = utility.generateNewItemId();
            i.upd.StackObjectsCount = remaining;
            returnItems.push(i);
            remaining = 0;
          }
        }
      }

      dialogue_f.handler.addDialogueMessage("5ac3b934156ae10c4430e83c", messageContent, sessionID, returnItems);
      offers.splice(i, 1);

      pmcData.RagfairInfo.rating -= _database.gameplay.ragfair.repLoss;
      continue;
    }

    if (!offer.sold || time < offer.sellTime) {
      continue;
    }

    // Send payment
    const messageTpl = _database.locales.global["ru"].mail["5bdac0b686f7743e1665e09e"];
    const tplVaris = {
      soldItem: _database.locales.global["ru"].templates[offer.rootTpl].Name,
      buyerNickname: fleaName(),
      itemCount: offer.count,
    };
    const messageText = messageTpl.replace(/{\w+}/g, (matched) => {
      return tplVaris[matched.replace(/{|}/g, "")];
    });

    const messageContent = {
      text: messageText,
      type: 4,
      maxStorageTime: _database.gameplay.other.RedeemTime * 3600,
      ragfair: {
        offerId: offer.id,
        count: offer.count,
        handbookId: offer.rootTpl
      }
    };

    let items = [];
    for (let req of offer.requirements) {
      let itemInfo = _database.items[req._tpl]._props;
      let remaining = req.count;

      if (!offer.sellInOnePiece) {
        remaining *= offer.count;
      }

      while (remaining > 0) {
        if (preset_f.handler.hasPreset(req._tpl) && req.onlyFunctional) {
          let presets = helper_f.clone(preset_f.handler.getPresets(req._tpl));
          items = [...items, ...presets[0]._items];
          remaining--;
          continue;
        }

        if (remaining > itemInfo.StackMaxSize) {
          let i = {
            _id: utility.generateNewItemId(),
            _tpl: req._tpl,
            upd: {
              StackObjectsCount: itemInfo.StackMaxSize,
            },
          };
          items.push(i);
          remaining -= itemInfo.StackMaxSize;
        } else {
          let i = {
            _id: utility.generateNewItemId(),
            _tpl: req._tpl,
            upd: {
              StackObjectsCount: remaining,
            },
          };
          items.push(i);
          remaining = 0;
        }
      }
    }

    dialogue_f.handler.addDialogueMessage("5ac3b934156ae10c4430e83c", messageContent, sessionID, items);
    offers.splice(i, 1);

    pmcData.RagfairInfo.rating += (_database.gameplay.ragfair.repGain * offer.summaryCost) / 50000;
  }

  return item_f.handler.getOutput();
}

module.exports.getOffers = getOffers;
module.exports.itemMarKetPrice = itemMarKetPrice;
module.exports.ragFairAddOffer = ragFairAddOffer;
module.exports.ragFairRemoveOffer = ragFairRemoveOffer;
module.exports.ragFairRenewOffer = ragFairRenewOffer;
module.exports.processOffers = processOffers;