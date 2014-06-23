!function(){

    var   Class         = require('ee-class')
        , log           = require('ee-log')
        , type          = require('ee-types')
        , async         = require('ee-async')
        , ORMExtension  = require('ee-orm-extension');


    var thisContext;


    module.exports = new Class({
        inherits: ORMExtension

        , left:     'left'
        , right:    'right'


        , init: function init(options) {
            init.super.call(this);

            // store this context so we'll have acces in some 
            // methods attached to the model
            thisContext = this;

            if (options) {
                if (options.left)   this.left           = options.left;
                if (options.right)  this.right          = options.right;
            }

            // storage for model specific configurations
            Class.define(this, '_configuration', Class({}));

            // check for grouping key, they can be used if
            // you are going to store multiple trees inside 
            // a single table
            if (options) {
                Object.keys(options).forEach(function(databaseName) {
                    if (databaseName !== 'left' && databaseName !== 'right') {
                        if (!this._configuration[databaseName]) this._configuration[databaseName] = {};

                        // loop trough tables
                        Object.keys(options[databaseName]).forEach(function(modelName) {
                            this._configuration[databaseName][modelName] = options[databaseName][modelName];
                        }.bind(this));
                    }
                }.bind(this));
            }
        }



        /*
         * event listener for the model beforeUpdate event, will
         * called by all models which this extension is applied to
         */
        , onBeforeUpdate: function(model, transaction, callback) {
            /*this._getTargetModelInstance(model, transaction, function(err, node) {
                if (err) callback(err);
                else {
                    // we're ready to process this query

                }
            }.bind(this));*/
            callback();
        }

        /*
         * event listener for the model beforeInsert event, will
         * called by all models which this extension is applied to
         */
        , onBeforeInsert: function(model, transaction, callback) {
            if (model._nestedSet) {
                // we need an exclusive table lock for this ...
                this._lock(model, transaction);

                // get the target model (none, new parent, before / after)
                this._getTargetModelInstance(model, transaction, function(err, node) {
                    if (err) callback(err);
                    else {
                        var   nestedSet     = model._nestedSet
                            , wait          = async.waiter(callback)
                            , ORM           = this.orm.getORM();

                        // we're ready to process this query, find the new position of this node
                        if (nestedSet.newRootNode) {
                            // we're a new root node
                            if (nestedSet.asLastChild && node) model[this.left] = node[this.right]+1;
                            else model[this.left] = 1;
                        }
                        if (nestedSet.parent) {
                            // new parent for this node
                            if (nestedSet.asLastChild) model[this.left] = node[this.right]-2;
                            else model[this.left] = node[this.left]+1;
                        }
                        else if (nestedSet.after) {
                            // after after node
                            model[this.left] = node[this.right]+1;
                        }
                        else if (nestedSet.before) {
                            // before after node
                            model[this.left] = node[this.left];
                        }

                        // right is on insert also left+1
                        model[this.right] = model[this.left]+1;


                        // move all nodes to the right
                        this._executeQuery(model, [{
                              key       : this.left
                            , value     : ORM.gte(model[this.left])
                        }], [{
                              key       : this.left
                            , value     : ORM.increaseBy(2)
                        }], transaction, wait());

                        this._executeQuery(model, [{
                              key       : this.right
                            , value     : ORM.gte(model[this.left])
                        }], [{
                              key       : this.right
                            , value     : ORM.increaseBy(2)
                        }], transaction, wait());
                    }
                }.bind(this));
            }
            else callback(new Error('No node position defined for the nested set on the model «'+model.getEntityName()+'». Please define one via the setParent, after or the before method.'));
        }

        /*
         * event listener for the model beforeDelete event, will
         * called by all models which this extension is applied to
         */
        , onBeforeDelete: function(model, transaction, callback) {
            callback();
        }


    
        /*
         * return the complete tree, load it from the db
         */
        , loadTree: function() {
           
        }


        /*
         * instructs this extnesion to not to appl ysoft delete
         * runs in the context of the model
         * runs in the context of the model
         */
        , setParent: function(node, asLastChild) {
            thisContext._prepareForNestedSet(this);
            this._nestedSet.parent      = node;
            this._nestedSet.asLastChild = !!asLastChild;

            if (type.undefined(node) || type.null(node)) this._nestedSet.newRootNode = true;
            return this;
        }


        /*
         * before this node to the targetnode
         * runs in the context of the model
         */
        , before: function(targetNode) {
            thisContext._prepareForNestedSet(this);
            this._nestedSet.before = targetNode;
            return this;
        }

        /*
         * after this node after the targetnode
         * runs in the context of the model
         */
        , after: function(targetNode) {
            thisContext._prepareForNestedSet(this);
            this._nestedSet.after = targetNode;
            return this;
        }


        /*
         * apply the exclusive table lock so the
         * nested set can be updated concurrently
         */
        , _lock: function(model, transaction) {
            transaction.lock(model.getEntityName(), transaction.LOCK_EXCLUSIVE);
        }


        /*
         * tries to load a model from the db when an id was provided.
         * reloads the model if a model was provided. executes a query
         * if one was provided.
         */
        , _getTargetModelInstance: function(model, transaction, callback) {
            var   databaseName
                , entityName
                , definition
                , filter
                , input;

            // find the data passed into the model
            if (model._nestedSet.parent) input = model._nestedSet.parent;
            else if (model._nestedSet.after) input = model._nestedSet.after;
            else if (model._nestedSet.before) input = model._nestedSet.before;

            if (model._nestedSet.newRootNode && model._nestedSet.asLastChild) {
                // try to get the last node
                definition      = model.getDefinition();
                databaseName    = definition.getDatabaseName();
                entityName      = model.getEntityName();
                filter          = this._createfilter(null, definition, databaseName, entityName);

                // go and find the last node
                this.orm[databaseName][entityName](filter, ['*']).order(this.right, true).findOne(callback, transaction);
            }
            else if (type.undefined(input) || type.null(input)) callback();
            else if (type.object(input) && ((type.function(input.isModel) && input.isModel()) || (type.function(input.isQuery) && input.isQuery()))) {
                if (type.function(input.isModel) && input.isModel()) input.reload(callback, transaction);
                else {
                    input.select(['*']).findOne(function(err, node) {
                        if (err) callback(err);
                        else if (!node) callback(new Error('The nested set on the model «'+model.getEntityName()+'» could not find the target node passed as a query.'));
                        else callback(null, node);
                    }.bind(this), transaction);
                }
            }
            else if(type.number(input) || type.string(input)) {
                definition      = model.getDefinition();
                filter          = {};
                databaseName    = definition.getDatabaseName();
                entityName      = definition.getTableName();

                // prepare filter
                filter = this._createfilter(input, definition, databaseName, entityName);

                // go and find the node
                this.orm[databaseName][entityName](filter, ['*']).findOne(function(err, node) {
                    if (err) callback(err);
                    else if (!node) callback(new Error('The nested set on the model «'+model.getEntityName()+'» could not find the target node using the input provided ('+input+').'));
                    else callback(null, node);
                }.bind(this), transaction);
            }
            else callback(new Error('The nested set on the model «'+model.getEntityName()+'» cannot handle the target provided. Accepting integers & strings (primary keys) or models or queries! You provided «'+type(input)+'»!'));
        }


        /*
         * execute a nested set specific query
         */
        , _executeQuery: function(model, filters, values, transaction, callback) {
            var   definition    = model.getDefinition()
                , databaseName  = definition.getDatabaseName()
                , entityName    = model.getEntityName();

            this.orm[databaseName][entityName](this._createfilter(null, definition, databaseName, entityName, filters)).update(this._createObject(values), callback, transaction);
        }



        /*
         * creates an object from an array contining keys & values
         */
        , _createObject: function(list, extingObject) {
            var obj = extingObject || {};

            if(type.array(list)) {
                list.forEach(function(item) {
                    obj[item.key] = item.value;
                });
            }

            return obj;
        }



        /*
         * build a basic filter object
         */
        , _createfilter: function(primaryValue, defintion, databaseName, entityName, filters) {
            var   filter = {}
                , groupKey;

            // prepare filter
            if (!type.null(primaryValue) && !type.undefined(primaryValue)) {
                if (defintion.primaryKeys.length !== 1) callback(new Error('The nested set on the model «'+entityName+'» cannot handle lookup targets with more or less than one primary key. Please provide a model or a query instead!'));
                defintion.primaryKeys.forEach(function(key) {
                    filter[key] = primaryValue;
                }.bind(this));
            }

            // maybe we have to use grouping
            if (this._configuration[databaseName] && this._configuration[databaseName][entityName] && this._configuration[databaseName][entityName].groupKey) {
                groupKey = this._configuration[databaseName][entityName].groupKey;
                if (type.undefined(model[groupKey]) || type.undefined(model[groupKey])) return callback(new Error('The nested set on the model «'+entityName+'» cannot apply the modification requested, the current model has no value for the groupKey «'+groupKey+'» set!'));

                filter[groupKey] = model[groupKey];
            }

            // add additional filters
            if(type.array(filters) )this._createObject(filters, filter);

            return filter;
        }


        /*
         * make sure the _nestedSet property is set on the model instance
         */
        , _prepareForNestedSet: function(target) {
            if (!target._neestedSet) Class.define(target, '_nestedSet', Class({}).Writable().Configurable());
        }


        /*
         * checks if this extension should be used on the current model
         * methods and properties may be installed on the models prototype
         */
        , applyModelMethods: function(definition, classDefinition) {
                
            // add this method to the model
            classDefinition.setParent   = this.setParent;
            classDefinition.after       = this.after;
            classDefinition.before      = this.before;
        }


        /*
         * checks if this extension should be used on the current querybuilder
         * methods and properties may be installed on the models prototype
         */
        , applyQueryBuilderMethods: function(definition, classDefinition) {

            // add this model to the querybuilder prototype
            classDefinition.loadTree = this.loadTree;
        }


        /*
         * checks if this extension should be applied to the 
         * current model
         */
        , useOnModel: function(definition) {
            return definition.hasColumn(this.left) && definition.hasColumn(this.right);
        }


    });
}();