exports.newTradingRecords = function newTradingRecords(bot, logger) {
    /*
    This module facilitates the appending of records to the output of the process.
    */
    const MODULE_NAME = 'Trading Records'

    let thisObject = {
        appendRecords: appendRecords,
        initialize: initialize,
        finalize: finalize
    }

    let tradingEngine
    let tradingSystem
    let sessionParameters
    let outputDatasetsMap

    return thisObject

    function initialize(pOutputDatasetsMap) {
        tradingEngine = bot.simulationState.tradingEngine
        tradingSystem = bot.simulationState.tradingSystem
        sessionParameters = bot.SESSION.parameters
        outputDatasetsMap = pOutputDatasetsMap  // These are the files turned into arrays, stored in a Map by Product codeName.
    }

    function finalize() {
        tradingEngine = undefined
        tradingSystem = undefined
        sessionParameters = undefined
        outputDatasetsMap = undefined
    }

    function appendRecords() {
        /*
            Here we add records to the output files. At the product config property nodePath
            we have a pointer to the node that have the information we need to extract.
            Later, based on the product record definition we will extract each individual value.
       */
        let outputDatasets = bot.processNode.referenceParent.processOutput.outputDatasets
        for (let i = 0; i < outputDatasets.length; i++) {
            let outputDatasetNode = outputDatasets[i]
            let dataset = outputDatasetNode.referenceParent
            let product = dataset.parentNode
            let outputDatasetArray = outputDatasetsMap.get(product.config.codeName)

            if (bot.processingDailyFiles === true && dataset.config.type === 'Daily Files') {
                persistRecords()
            }

            if (bot.processingDailyFiles === false && dataset.config.type === 'Market Files') {
                persistRecords()
            }

            function persistRecords() {

                /* Clean the file from information of previous executions */
                pruneOutputFile(product, outputDatasetArray)

                /*
                The product root can be a node or a node property of type array.
                */
                let productRoot = eval(product.config.nodePath)

                if (product.config.nodePathType === 'array') {
                    /* 
                    This means that the configured nodePath is not pointing to a node, but to a node property that is an array.
                    For that reason we will assume that each element of the array is a record to be outputed
                    */
                    for (let index = 0; index < productRoot.length; index++) {
                        /*
                        The Product Root Node is the root of the node hiriarchy from where we are going to extract the record values.
                        */
                        let productRootNode = productRoot[index]
                        let record = scanRecordDefinition(product, productRootNode, index)
                        persistIndividualRecord(record, product, outputDatasetArray)
                    }
                } else {
                    /*
                    This means that the configured nodePath points to a single node, which is the one whose children constitutes
                    the record to be saved at the output file.
                    */
                    /*
                    The Product Root Node is the root of the node hiriarchy from where we are going to extract the record values.
                    */
                    let productRootNode = productRoot
                    let record = scanRecordDefinition(product, productRootNode)
                    persistIndividualRecord(record, product, outputDatasetArray)
                }
            }
        }

        function persistIndividualRecord(record, product, outputDatasetArray) {

            if (product.config.saveAsObjects === true) {
                /* For saving objects we need to take care of a different set of rules. */
                for (let j = 0; j < product.record.properties.length; j++) {
                    let recordProperty = product.record.properties[j]
                    if (recordProperty.config.codeName === product.config.propertyNameThatDefinesObject) {
                        let propertyValue = record[j]

                        /* Remove Open Records */
                        spliceOpenRecords(j, product, outputDatasetArray)

                        if (bot.processingDailyFiles) {
                            /*
                            When dealing with Daily Files, we need to avoid to write an open object at the last 'candle' of the day,
                            since the object will be duplicated on the next day. How do we know we are positioned at the last candle
                            of the day? Easy: the end of the candle must be 1 millisecod before the next day. That happens at any 
                            time frame. 
                            */
                            let currentDay = new Date(tradingEngine.current.candle.end.value)
                            let nextDay = new Date(tradingEngine.current.candle.end.value + 1)
                            if (currentDay.getUTCDate() !== nextDay.getUTCDate()) {
                                /*
                                We will save the object only if it is closed, becasuse we are at the last candle of the day.
                                */
                                if (propertyValue === product.config.propertyValueThatClosesObject) {
                                    outputDatasetArray.push(record)
                                }
                            } else {
                                /*
                                When we are not at the end of the day, we will save the object normally, like in market files.
                                */
                                if (propertyValue !== product.config.propertyValueThatPreventsSavingObject) {
                                    outputDatasetArray.push(record)
                                }
                            }
                        }
                        else {
                            /*
                            For Market Files we will add a record everytime that proeprty value does not match this
                            */
                            if (propertyValue !== product.config.propertyValueThatPreventsSavingObject) {
                                outputDatasetArray.push(record)
                            }
                        }
                        break
                    }
                }
            } else {
                /* When we are not dealing with objects, we add every record to the existing file. */
                outputDatasetArray.push(record)
            }
        }

        function scanRecordDefinition(product, productRootNode, index) {

            let record = []
            for (let j = 0; j < product.record.properties.length; j++) {
                let recordProperty = product.record.properties[j]
                /* 
                The Property Root Node is the Root of the Hiriarchy branch we must find in order
                to get the node where we are going to extract the value. Initially
                we point it to the Product Root Node, because that is the default in case
                a property does not have at its configuration a different nodePath configured
                pointing to an specific Root for the property.
                */
                let propertyRootNode = productRootNode
                /*
                If we find at the configuration a nodePath, then we take this path to find
                the Root Node specifically for this property only.
                */
                if (recordProperty.config.nodePath !== undefined) {
                    propertyRootNode = eval(recordProperty.config.nodePath)
                }
                /* 
                The Target Node is the node from where we are going to exctract the value.
                We will use the codeName of the Record Property to match it with 
                the any of the properties of the Root Node to get the Target Node.  
                */
                let targetNode = propertyRootNode[recordProperty.config.codeName]
                /*
                If the codeName of the Record Property can not match the name of the property at
                the target node, the user can explicitly specify the property name at the configuration,
                and in those cases we need to use that. This happens when there are many Record Properties
                pointing to the same property at the Target Node.
                */
                if (recordProperty.config.childProperty !== undefined) {
                    targetNode = propertyRootNode[recordProperty.config.childProperty]
                }
                /*
                It can happen that intead of having a Node in targetNode what we have is an
                array of nodes. We need to pick one of the elements of the array and for that
                we use the Index value we find at the configuration of the Record Property.
                */
                if (recordProperty.config.index !== undefined) {
                    targetNode = targetNode[recordProperty.config.index]
                }
                /* 
                By Default the value is extracted from the value property of the Target Node.
                But it might happen the the Target Node does not exist for example when there is an Array
                of Nodes defined in the Record Properties but not all of them exist at the Root Node.
                We filter out those cases by not extracting the value from the value property.
                */
                let value = 0 // This is a default value, since we do not want null in files because it breakes JSON format.
                if (targetNode !== undefined) {
                    if (targetNode.type !== undefined) {
                        /*
                        In this case the Target Node is really a node (since it has a type), so we extract the value
                        from its value property.
                        */
                        value = targetNode.value

                        if (recordProperty.config.decimals !== undefined) {
                            value = Number(value.toFixed(recordProperty.config.decimals))
                        }
                    } else {
                        /*
                        In this case the Target Node is not really node, but the value itself. Se we return this as the
                        value of the Record Property.
                        */
                        value = targetNode
                    }
                }
                if (recordProperty.config.isString !== true && Array.isArray(value) !== true) {
                    value = safeNumericValue(value)
                }
                if (recordProperty.config.isString === true && Array.isArray(value) !== true) {
                    value = safeStringValue(value)
                }
                record.push(value)
            }
            return record
        }

        function safeNumericValue(value) {
            /*
            The purpose of this function is to check that value variable does not have a value that 
            will later break the JSON format of files where this is going to be stored at. 
            */
            if (value === Infinity) {
                value = Number.MAX_SAFE_INTEGER
            }
            if (value === undefined) {
                value = 0
            }
            if (value === null) {
                value = 0
            }
            if (isNaN(value)) {
                value = 0
            }
            return value
        }

        function safeStringValue(value) {
            /*
            The purpose of this function is to check that value variable does not have a value that 
            will later break the JSON format of files where this is going to be stored at. 
            */
            if (value === undefined) {
                value = ''
            }
            if (value === null) {
                value = ''
            }
            return value
        }

        function pruneOutputFile(product, outputFile) {
            if (outputFile.isPrunned === true) { return }
            /*
            When a session is resumed, we will be potentially reading output files belonging to a previous session execution. 
            For that reason we need to prune all the records that are beyond the current candle. We do not delete everything
            because we might be resuming a stopped session, which is fine. 
            */
            for (let i = 0; i < outputFile.length; i++) {
                let record = outputFile[i]

                for (let j = 0; j < product.record.properties.length; j++) {
                    let recordProperty = product.record.properties[j]
                    if (recordProperty.config.codeName === 'end') {
                        let end = record[j]
                        if (end >= tradingEngine.current.candle.end.value) {
                            outputFile.splice(i, 1)
                            pruneOutputFile(product, outputFile)
                            return
                        }
                    }
                }
            }
            outputFile.isPrunned = true
        }

        function spliceOpenRecords(j, product, outputDatasetArray) {
            /*
            Before adding records to the output file, we need to remove all open records, 
            because we will be adding the same records later with potentially
            new or updated information.
            */

            for (let i = 0; i < outputDatasetArray.length; i++) {
                let dataRecord = outputDatasetArray[i]
                if (dataRecord !== undefined) {
                    let dataRecordValue = dataRecord[j]
                    if (dataRecordValue !== product.config.propertyValueThatClosesObject) {
                        outputDatasetArray.splice(i, 1)
                        spliceOpenRecords(j, product, outputDatasetArray)
                        return
                    }
                }
            }
        }
    }
}