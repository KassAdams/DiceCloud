import SimpleSchema from 'simpl-schema';
import schema from '/imports/api/schema.js';
import PropertySchema from '/imports/api/creature/subSchemas/PropertySchema.js';
import ChildSchema from '/imports/api/parenting/ChildSchema.js';

// Mixins
import recomputeCreatureMixin from '/imports/api/mixins/recomputeCreatureMixin.js';
import creaturePermissionMixin from '/imports/api/mixins/creaturePermissionMixin.js';
import { setDocToLastMixin } from '/imports/api/mixins/setDocToLastMixin.js';
import { setDocAncestryMixin, ensureAncestryContainsCharIdMixin } from '/imports/api/parenting/parenting.js';
import simpleSchemaMixin from '/imports/api/mixins/simpleSchemaMixin.js';

let Proficiencies = new Mongo.Collection("proficiencies");

let ProficiencySchema = schema({
	name: {
		type: String,
		optional: true,
	},
	// A number representing how proficient the character is
	value: {
		type: Number,
		allowedValues: [0, 0.5, 1, 2],
		defaultValue: 1,
	},
	// The variableName of the skill to apply this to
	skill: {
		type: String,
		optional: true,
	},
});

Proficiencies.attachSchema(ProficiencySchema);
Proficiencies.attachSchema(PropertySchema);
Proficiencies.attachSchema(ChildSchema);

const insertProficiency = new ValidatedMethod({
  name: 'Proficiencies.methods.insert',
	mixins: [
    creaturePermissionMixin,
    setDocToLastMixin,
    setDocAncestryMixin,
    ensureAncestryContainsCharIdMixin,
		recomputeCreatureMixin,
    simpleSchemaMixin,
  ],
  collection: Proficiencies,
  permission: 'edit',
  schema: ProficiencySchema,
  run(prof) {
		return Proficiencies.insert(prof);
  },
});

const updateProficiency = new ValidatedMethod({
  name: 'Proficiencies.methods.update',
  mixins: [
    creaturePermissionMixin,
		recomputeCreatureMixin,
    simpleSchemaMixin,
  ],
  collection: Proficiencies,
  permission: 'edit',
  schema: new SimpleSchema({
    _id: SimpleSchema.RegEx.Id,
    update: ProficiencySchema.omit('name'),
  }),
  run({_id, update}) {
		return Proficiencies.update(_id, {$set: update});
  },
});

export default Proficiencies;
export { ProficiencySchema, insertProficiency, updateProficiency };