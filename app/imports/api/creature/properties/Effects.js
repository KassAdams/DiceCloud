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

let Effects = new Mongo.Collection('effects');

/*
 * Effects are reason-value attached to skills and abilities
 * that modify their final value or presentation in some way
 */
let EffectSchema = schema({
	name: {
		type: String,
		optional: true,
	},
	operation: {
		type: String,
		defaultValue: 'add',
		allowedValues: [
			'base',
			'add',
			'mul',
			'min',
			'max',
			'advantage',
			'disadvantage',
			'passiveAdd',
			'fail',
			'conditional',
		],
	},
	calculation: {
		type: String,
		optional: true,
	},
	//which stat the effect is applied to
	stat: {
		type: String,
		optional: true,
	},
});

const EffectComputedSchema = new SimpleSchema({
	// The computed result of the effect
	result: {
		type: SimpleSchema.oneOf(Number, String),
		optional: true,
	},
}).extend(EffectSchema);

Effects.attachSchema(PropertySchema);
Effects.attachSchema(ChildSchema);
Effects.attachSchema(EffectComputedSchema);

const insertEffect = new ValidatedMethod({
  name: 'Effects.methods.insert',
	mixins: [
    creaturePermissionMixin,
    setDocAncestryMixin,
    ensureAncestryContainsCharIdMixin,
		recomputeCreatureMixin,
		setDocToLastMixin,
    simpleSchemaMixin,
  ],
  collection: Effects,
  permission: 'edit',
  schema: EffectSchema,
  run(effect) {
		return Effects.insert(effect);
  },
});

const updateEffect = new ValidatedMethod({
  name: 'Effects.methods.update',
  mixins: [
    creaturePermissionMixin,
		recomputeCreatureMixin,
    simpleSchemaMixin,
  ],
  collection: Effects,
  permission: 'edit',
  schema: new SimpleSchema({
    _id: SimpleSchema.RegEx.Id,
    update: EffectSchema.omit('name'),
  }),
  run({_id, update}) {
		return Effects.update(_id, {$set: update});
  },
});

export default Effects;
export { EffectSchema };