import SimpleSchema from 'simpl-schema';
import schema from '/imports/api/schema.js';
import ColorSchema from "/imports/api/creature/subSchemas/ColorSchema.js";
import PropertySchema from '/imports/api/creature/subSchemas/PropertySchema.js';
import ChildSchema from '/imports/api/parenting/ChildSchema.js';

// Mixins
import creaturePermissionMixin from '/imports/api/mixins/creaturePermissionMixin.js';
import { setDocToLastMixin } from '/imports/api/mixins/setDocToLastMixin.js';
import { setDocAncestryMixin, ensureAncestryContainsCharIdMixin } from '/imports/api/parenting/parenting.js';
import simpleSchemaMixin from '/imports/api/mixins/simpleSchemaMixin.js';

let SpellLists = new Mongo.Collection("spellLists");

let SpellListSchema = schema({
	name: {
		type: String,
		optional: true,
	},
	description: {
		type: String,
		optional: true,
	},
	// Calculation of save DC used for all spells in this list
	saveDC: {
		type: String,
		optional: true,
	},
	// Calculation of attack bonus used for all spells in this list
	attackBonus: {
		type: String,
		optional: true,
	},
	// Calculation of how many spells in this list can be prepared
	maxPrepared: {
		type: String,
		optional: true,
	},
});

SpellListSchema.extend(ColorSchema);

SpellLists.attachSchema(SpellListSchema);
SpellLists.attachSchema(PropertySchema);
SpellLists.attachSchema(ChildSchema);

const insertSpellList = new ValidatedMethod({
  name: 'SpellLists.methods.insert',
	mixins: [
    creaturePermissionMixin,
    setDocToLastMixin,
    setDocAncestryMixin,
    ensureAncestryContainsCharIdMixin,
    simpleSchemaMixin,
  ],
  collection: SpellLists,
  permission: 'edit',
  schema: SpellListSchema,
  run(spellList) {
		return SpellLists.insert(spellList);
  },
});

const updateSpellList = new ValidatedMethod({
  name: 'SpellLists.methods.update',
  mixins: [
    creaturePermissionMixin,
    simpleSchemaMixin,
  ],
  collection: SpellLists,
  permission: 'edit',
  schema: new SimpleSchema({
    _id: SimpleSchema.RegEx.Id,
    update: SpellListSchema.omit('name'),
  }),
  run({_id, update}) {
		return SpellLists.update(_id, {$set: update});
  },
});

export default SpellLists;