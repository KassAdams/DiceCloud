// TODO allow abilities to get advantage/disadvantage, making all skills that are based
// on them disadvantaged as well

import { ValidatedMethod } from 'meteor/mdg:validated-method';
import SimpleSchema from 'simpl-schema';
import { assertEditPermission } from '/imports/api/creature/creaturePermissions.js';
import Creatures from "/imports/api/creature/Creatures.js";
import Attributes from "/imports/api/creature/properties/Attributes.js";
import Skills from "/imports/api/creature/properties/Skills.js";
import Effects from "/imports/api/creature/properties/Effects.js";
import Proficiencies from "/imports/api/creature/properties/Proficiencies.js";
import DamageMultipliers from "/imports/api/creature/properties/DamageMultipliers.js";
import Classes from "/imports/api/creature/properties/Classes.js";
import * as math from 'mathjs';

export const recomputeCreature = new ValidatedMethod({

  name: "Creatures.methods.recomputeCreature",

  validate: new SimpleSchema({
    charId: { type: String }
  }).validator(),

  run({charId}) {
    // Permission
    assertEditPermission(charId, this.userId);

    // Work, call this direcly if you are already in a method that has checked
    // for permission to edit a given character
    recomputeCreatureById(charId);
  },

});

 /**
  * This function is the heart of DiceCloud. It recomputes a creature's stats,
  * distilling down effects and proficiencies into the final stats that make up
  * a creature.
  *
  * Essentially this is a depth first tree traversal algorithm that computes
  * stats' dependencies before computing stats themselves, while detecting
  * dependency loops.
  *
  * At the moment it makes no effort to limit recomputation to just what was
  * changed.
  *
  * Attempting to implement dependency management to limit recomputation to just
  * change affected stats should only happen as a last resort, when this function
  * can no longer be performed more efficiently, and server resources can not be
  * expanded to meet demand.
  *
  * A brief overview:
  * - Fetch the stats of the creature and add them to
  *   an object for quick lookup
  * - Fetch the effects and proficiencies which apply to each stat and store them with the stat
  * - Fetch the class levels and store them as well
  * - Mark each stat and effect as uncomputed
  * - Iterate over each stat in order and compute it
  *   - If the stat is already computed, skip it
  *   - If the stat is busy being computed, we are in a dependency loop, make it NaN and mark computed
  *   - Mark the stat as busy computing
  *   - Iterate over each effect which applies to the attribute
  *     - If the effect is not computed compute it
  *       - If the effect relies on another attribute, get its computed value
  *       - Recurse if that attribute is uncomputed
  *     - apply the effect to the attribute
  *   - Conglomerate all the effects to compute the final stat values
  *   - Mark the stat as computed
  * - Write the computed results back to the database
  *
  * @param  {String} charId the Id of the creature to compute
  * @returns {Object}       An in-memory description of the character as
  *                         computed and written to the database
  */
export function recomputeCreatureById(charId){
  let char = buildCreature(charId);
  char = computeCreature(char);
  writeCreature(char);
  return char;
}

/**
 * Write the in-memory creature to the database docs
 * This could be optimized to only write changed fields to the database
 *
 * @param  {Object} char in-memory char object
 * @returns {undefined}
 */
function writeCreature(char) {
  writeAttributes(char);
  writeSkills(char);
  writeDamageMultipliers(char);
  writeEffects(char);
  writeCreatureDoc(char);
}

function writeCreatureDoc(char) {
  // Store all the variables, using the same priority as computation evaluation
  let variables = {};
  for (let key in char.variables){
    variables[key] = char.variables[key].result;
  }

  // Write the creature
  Creatures.update(char.id, {$set: {level: char.level, variables}});
}

/*
 * Write all the attributes from the in-memory char object to the Attirbute docs
 */
function writeAttributes(char) {
  let bulkWriteOps =  _.map(char.atts, (att, variableName) => {
    let op = {
      updateMany: {
        filter: {charId: char.id, variableName},
        update: {$set: {
          value: att.result,
        }},
      }
    };
    if (typeof att.mod === 'number'){
      op.updateMany.update.$set.mod = att.mod;
    } else {
      op.updateMany.update.$unset = {mod: 1};
    }
    return op;
  });
  if (Meteor.isServer){
    Attributes.rawCollection().bulkWrite(bulkWriteOps, {ordered : false}, function(e, r){
      if (e) console.warn(JSON.stringify(e, null, 2));
    });
  } else {
    _.each(bulkWriteOps, op => {
      Attributes.update(op.updateMany.filter, op.updateMany.update, {multi: true});
    });
  }
}

function writeEffects(char){
  let bulkWriteOps =  _.map(char.computedEffects, effect => ({
    updateOne: {
      filter: {_id: effect._id},
      update: {$set: {
        result: effect.result,
      }},
    },
  }));
  if (Meteor.isServer){
    Effects.rawCollection().bulkWrite(bulkWriteOps, {ordered : false}, function(e, r){
      if (e) console.warn(JSON.stringify(e, null, 2));
    });
  } else {
    _.each(bulkWriteOps, op => {
      Effects.update(op.updateOne.filter, op.updateOne.update);
    });
  }
}

/**
 * Write all the skills from the in-memory char object to the Skills docs
 *
 * @param  {type} char description
 * @returns {type}      description
 */
function writeSkills(char) {
  let bulkWriteOps =  _.map(char.skills, (skill, variableName) => {
    let op = {
      updateMany: {
        filter: {charId: char.id, variableName},
        update: {$set: {
          value: skill.result,
          abilityMod: skill.abilityMod,
          advantage: skill.advantage,
          passiveBonus: skill.passiveAdd,
          proficiency: skill.proficiency,
          conditionalBenefits: skill.conditional,
          fail: skill.fail,
        }},
      }
    };
    return op;
  });
  if (Meteor.isServer){
    Skills.rawCollection().bulkWrite( bulkWriteOps, {ordered : false}, function(e, r){
      if (e) console.warn(JSON.stringify(e, null, 2));
    });
  } else {
    _.each(bulkWriteOps, op => {
      Skills.update(op.updateMany.filter, op.updateMany.update, {multi: true});
    });
  }
}

 /**
  * Write all the damange multipliers from the in-memory char object to the docs
  *
  * @param  {type} char description
  * @returns {type}      description
  */
function writeDamageMultipliers(char) {
  let bulkWriteOps =  _.map(char.dms, (dm, variableName) => {
    let op = {
      updateMany: {
        filter: {charId: char.id, variableName},
        update: {$set: {
          value: dm.result,
        }},
      }
    };
    return op;
  });
  if (Meteor.isServer){
    DamageMultipliers.rawCollection().bulkWrite( bulkWriteOps, {ordered : false}, function(e, r){
      if (e) console.warn(JSON.stringify(e, null, 2));
    });
  } else {
    _.each(bulkWriteOps, op => {
      DamageMultipliers.update(op.updateMany.filter, op.updateMany.update, {multi: true});
    });
  }
}


 /**
  * Get the creature's data from the database and build an in-memory model that
  * can be computed. Hits 7 database collections with indexed queries.
  *
  * @param  {type} charId description
  * @returns {type}        description
  */
function buildCreature(charId){
  let char = {
    id: charId,
    atts: {},
    skills: {},
    dms: {},
    classes: {},
    variables: {},
    otherEffects: [],
    computedEffects: [],
    level: 0,
  };
  // Fetch the attributes of the creature and add them to an object for quick lookup
  Attributes.find({charId}).forEach(attribute => {
    const key = attribute.variableName;
    if (!char.atts[key]){
      char.atts[key] = {
        computed: false,
        busyComputing: false,
        type: "attribute",
        attributeType: attribute.type,
        base: attribute.baseValue || 0,
        decimal: attribute.decimal,
        result: 0,
        mod: 0, // The resulting modifier if this is an ability
        add: 0,
        mul: 1,
        min: Number.NEGATIVE_INFINITY,
        max: Number.POSITIVE_INFINITY,
        effects: [],
      };
      char.variables[key] = char.atts[key];
      if (attribute.type === 'ability' && !char.variables[key + "Mod"]){
        char.variables[key + "Mod"] = {
          type: "abilityMod",
          ability: char.atts[key],
          get result(){
            return this.ability.mod;
          },
          get computed(){
            return this.ability.computed;
          },
        };
      }
    }
  });

  // Fetch the skills of the creature and store them
  Skills.find({charId}).forEach(skill => {
    const key = skill.variableName;
    if (!char.skills[key]){
      char.skills[key] = {
        computed: false,
        busyComputing: false,
        type: "skill",
        ability: skill.ability,
        base: skill.baseValue,
        result: 0, // For skills the result is the skillMod
        proficiency: skill.baseProficiency || 0,
        add: 0,
        mul: 1,
        min: Number.NEGATIVE_INFINITY,
        max: Number.POSITIVE_INFINITY,
        advantage: 0,
        disadvantage: 0,
        passiveAdd: 0,
        fail: 0,
        conditional: 0,
        effects: [],
        proficiencies: [],
      };
      if (!char.variables[key]){
        char.variables[key] = char.skills[key];
      }
    }
  });

  // Fetch the damage multipliers of the creature and store them
  DamageMultipliers.find({charId}).forEach(damageMultiplier =>{
    const key = damageMultiplier.variableName;
    if (!char.dms[key]){
      char.dms[key] = {
        computed: false,
        busyComputing: false,
        type: "damageMultiplier",
        result: 0,
        immunityCount: 0,
        ressistanceCount: 0,
        vulnerabilityCount: 0,
        effects: [],
      };
      if (!char.variables[key]){
        char.variables[key] = char.dms[key];
      }
    }
  });

  // Fetch the class levels and store them
  // don't use the word "class" it's reserved
  const levelOverwritten = !!char.variables.level;
  if (!levelOverwritten){
    char.variables.level = {
      result: 0,
      type: 'characterLevel',
      computed: true,
    };
  }
  Classes.find({charId}).forEach(cls => {
    const strippedCls = cls.name.replace(/\s+/g, '');
    if (!char.classes[strippedCls]){
      char.classes[strippedCls] = {level: cls.level};
      char.level += cls.level;
      if (!char.variables[strippedCls]){
        char.variables[strippedCls + "Level"] = {
          result: cls.level,
          type: 'classLevel',
          computed: true,
        };
      }
      if (!levelOverwritten){
        char.variables.level.result = char.level;
      }
    }
  });

  // Add direct properties from creature to variable list
  const fields = { xp: 1, weightCarried: 1};
  const creature = Creatures.findOne(charId, {fields});
  for (let key in fields){
    if (!char.variables[key]){
      char.variables[key] = {
        result: creature[key] || 0,
        type: 'creatureProperty',
        computed: true,
      };
    }
  }

  // Fetch the effects which apply to each stat and store them under the attribute
  Effects.find({
    charId: charId,
    enabled: true,
  }).forEach(effect => {
    let storedEffect = {
      _id: effect._id,
      computed: false,
      result: 0,
      operation: effect.operation,
      calculation: effect.calculation,
    };
    if (char.atts[effect.stat]) {
      char.atts[effect.stat].effects.push(storedEffect);
    } else if (char.skills[effect.stat]) {
      char.skills[effect.stat].effects.push(storedEffect);
    } else if (char.dms[effect.stat]) {
      char.dms[effect.stat].effects.push(storedEffect);
    } else {
      char.otherEffects.push(storedEffect);
    }
  });

  // Fetch the proficiencies and store them under each skill
  Proficiencies.find({
    charId: charId,
    enabled: true,
  }).forEach(proficiency => {
    if (char.skills[proficiency.skill]) {
      char.skills[proficiency.skill].proficiencies.push(proficiency);
    }
  });
  return char;
}

/**
 *  Compute the creature's stats in-place, returns the same char object
 * @param  {type} char description
 * @returns {type}      description
 */
export function computeCreature(char){
  // Iterate over each stat in order and compute it
  let statName;
  for (statName in char.atts){
    let stat = char.atts[statName];
    computeStat (stat, char);
  }
  for (statName in char.skills){
    let stat = char.skills[statName];
    computeStat (stat, char);
  }
  for (statName in char.dms){
    let stat = char.dms[statName];
    computeStat (stat, char);
  }
  for (let effect of char.otherEffects){
    computeEffect(effect, char);
  }
  return char;
}


/**
 * Compute a single stat on a creature
 *
 * @param  {type} stat description
 * @param  {type} char description
 * @returns {type}      description
 */
function computeStat(stat, char){
  // Ability mods aren't stats, use the stat they are based off of
  if (stat.type === 'abilityMod'){
    stat = stat.ability;
  }

  // If the stat is already computed, skip it
  if (stat.computed) return;

  // If the stat is busy being computed, make it NaN and mark computed
  if (stat.busyComputing){
    // Trying to compute this stat again while it is already computing.
    // We must be in a dependency loop.
    stat.computed = true;
    stat.result = NaN;
    stat.busyComputing = false;
    return;
  }


  // Iterate over each effect which applies to the stat
  for (let i in stat.effects){
    computeEffect(stat.effects[i], char);
    // apply the effect to the stat
    applyEffect(stat.effects[i], stat);
  }

  // Conglomerate all the effects to compute the final stat values
  combineStat(stat, char);

  // Mark the attribute as computed
  stat.computed = true;
  stat.busyComputing = false;
}

 /**
  * Compute a the result of a single effect
  */
function computeEffect(effect, char){
  if (effect.computed) return;
  if (_.isFinite(effect.calculation)){
		effect.result = +effect.calculation;
	} else if(effect.operation === "conditional"){
    effect.result = effect.calculation;
  } else if(_.contains(["advantage", "disadvantage", "fail"], effect.operation)){
    effect.result = 1;
  } else {
		effect.result = evaluateCalculation(effect.calculation, char);
	}
  effect.computed = true;
  char.computedEffects.push(effect);
}

/**
 * Apply a computed effect to its stat
 */
function applyEffect(effect, stat){
  if (!_.has(stat, effect.operation)){
    return;
  }
  switch(effect.operation){
    case "base":
      // Take the largest base value
      stat.base = effect.result > stat.base ? effect.result : stat.base;
      break;
    case "add":
      // Add all adds together
      stat.add += effect.result;
      break;
    case "mul":
      // Multiply the muls together
      stat.mul *= effect.result;
      break;
    case "min":
      // Take the largest min value
      stat.min = effect.result > stat.min ? effect.result : stat.min;
      break;
    case "max":
      // Take the smallest max value
      stat.max = effect.result < stat.max ? effect.result : stat.max;
      break;
    case "advantage":
      // Sum number of advantages
      stat.advantage++;
      break;
    case "disadvantage":
      // Sum number of disadvantages
      stat.disadvantage++;
      break;
    case "passiveAdd":
      // Add all passive adds together
      stat.passiveAdd += effect.result;
      break;
    case "fail":
      // Sum number of fails
      stat.fail++;
      break;
    case "conditional":
      // Sum number of conditionals
      stat.conditional++;
      break;
  }
}


/**
 * Combine the results of multiple effects to get the result of the stat
 */
function combineStat(stat, char){
  if (stat.type === "attribute"){
    combineAttribute(stat, char);
  } else if (stat.type === "skill"){
    combineSkill(stat, char);
  } else if (stat.type === "damageMultiplier"){
    combineDamageMultiplier(stat, char);
  }
}


/**
 * combineAttribute - Combine attributes's results into final values
 */
function combineAttribute(stat, char){
  stat.result = (stat.base + stat.add) * stat.mul;
  if (stat.result < stat.min) stat.result = stat.min;
  if (stat.result > stat.max) stat.result = stat.max;
  if (!stat.decimal) stat.result = Math.floor(stat.result);
  if (stat.attributeType === "ability") {
    stat.mod = Math.floor((stat.result - 10) / 2);
  }
}


/**
 * Combine skills results into final values
 */
function combineSkill(stat, char){
  for (let i in stat.proficiencies){
    let prof = stat.proficiencies[i];
    if (prof.value > stat.proficiency) stat.proficiency = prof.value;
  }
  let profBonus;
  if (char.skills.proficiencyBonus){
    if (!char.skills.proficiencyBonus.computed){
      computeStat(char.skills.proficiencyBonus, char);
    }
    profBonus = char.skills.proficiencyBonus.result;
  } else {
    profBonus = Math.floor(char.level / 4 + 1.75);
  }
  profBonus *= stat.proficiency;
  // Skills are based on some ability Modifier
  stat.abilityMod = 0;
  if (stat.ability && char.atts[stat.ability]){
    if (!char.atts[stat.ability].computed){
      computeStat(char.atts[stat.ability], char);
    }
    stat.abilityMod = char.atts[stat.ability].mod;
  }
  stat.result = (stat.abilityMod + profBonus + stat.add) * stat.mul;
  if (stat.result < stat.min) stat.result = stat.min;
  if (stat.result > stat.max) stat.result = stat.max;
  stat.result = Math.floor(stat.result);
  if (stat.base > stat.result) stat.result = stat.base;
}

/**
 * Combine damageMultiplier's results into final values
 */
function combineDamageMultiplier(stat, char){
  if (stat.immunityCount) return 0;
  if (stat.ressistanceCount && !stat.vulnerabilityCount){
    stat.result = 0.5;
  }  else if (!stat.ressistanceCount && stat.vulnerabilityCount){
    stat.result = 2;
  } else {
    stat.result = 1;
  }
}

/**
 * Get the value of a key, compute it if necessary
 */
function getComputedValueOfKey(sub, char){
  const stat = char.variables[sub];
  if (!stat) return null;
  if (!stat.computed){
    computeStat(stat, char);
  }
  return stat.result;
}

/**
 * Evaluate a string computation in the context of a char
 */
function evaluateCalculation(string, char){
  if (!string) return string;
  // Parse the string using mathjs
  let calc;
  try {
    calc = math.parse(string);
  } catch (e) {
    return string;
  }
  // Replace all symbols with known values
  let substitutedCalc = calc.transform(node => {
    if (node.isSymbolNode) {
      let val = getComputedValueOfKey(node.name, char);
      if (val === null) return node;
      return new math.expression.node.ConstantNode(val);
    }
    else {
      return node;
    }
  });

  // Evaluate the expression to a number or return with substitutions
  try {
    return substitutedCalc.eval();
  } catch (e){
    return substitutedCalc.toString();
  }
}

/**
 * recompute a character's XP from a given id
 */
export const recomputeCreatureXP = new ValidatedMethod({
  name: "Creatures.methods.recomputeCreatureXP",

  validate: new SimpleSchema({
    charId: { type: String }
  }).validator(),

  run({charId}) {
    assertEditPermission(charId, this.userId);
    var xp = 0;
		Experiences.find(
			{charId: charId},
			{fields: {value: 1}}
		).forEach(function(e){
			xp += e.value;
		});

    Creatures.update(charId, {$set: {xp}});
		return xp;
  },
});


/**
 * Recompute a character's weight carried from a given id
 */
export const recomputeCreatureWeightCarried = new ValidatedMethod({
  name: "Creature.methods.recomputeCreatureWeightCarried",

  validate: new SimpleSchema({
    charId: { type: String }
  }).validator(),

  run({charId}){
    assertEditPermission(charId, this.userId);
    var weightCarried = 0;
    // store a dictionary of carried containers
    var carriedContainers = {};
    Containers.find(
      {
        charId,
        isCarried: true,
      },
      { fields: {
        isCarried: 1,
        weight: 1,
      }}
    ).forEach(container => {
      carriedContainers[container._id] = true;
      weightCarried += container.weight;
    });
    Items.find(
      {
        charId,
      },
      { fields: {
        weight: 1,
        parent: 1,
      }}
    ).forEach(item => {
      // if the item is carried/equiped or in a carried container, add its weight
      if (parent.id === charId || carriedContainers[parent.id]){
        weightCarried += item.weight;
      }
    });

    Creatures.update(charId, {$set: {weightCarried}});
    return weightCarried;
  }
});