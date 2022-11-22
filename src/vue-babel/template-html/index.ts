import traverse from "@babel/traverse";
import parser from "@babel/parser";
import generate from "@babel/generator";
import t from '@babel/types';
import { DomUtils } from "htmlparser2";
import {getRefName} from '../template-script/utils'

const { parse } = parser;
let adapterVariable = 'let interpolation = '

export const templateRender = async (dom: any, scriptData: any,html) => {

  const RenderCallbacks: Array<Function> = [];
 
  const { dataRender,mixinRender,vuexRender} = scriptData;

  const addPrefixIdentifier = (path: any, replaceData:  {prefix:string,value:string}) => {
    const {prefix,value} = replaceData;
    if (prefix) {
      const identifierNode = path.node;
      if (!t.isIdentifier(identifierNode)) return
      let node = t.memberExpression(t.identifier(prefix), identifierNode)
      try {
        if (t.isObjectProperty(path.parent)) {
          path.parent.value = node;
        } else {
          path.replaceWith(node)    
        }
      } catch (error) {
       throw new Error(error);
     }
    }else{
      let node = t.identifier(value)
      path.replaceWith(node) 
    }
  }


  const removeAdapterVal = (code) => {
    // 需要处理
    let newCode = code.replaceAll(adapterVariable,'')
    newCode = newCode.replaceAll(';','')
    return newCode;
  }

  const loopInterpolation = (elem: any) => {
    let str = elem.data;
    let interpolationList: Array<any> = [];
    let pattern = /\{\{([\s\S]+?)\}\}/g;
    let strItem;
    while (strItem = pattern.exec(str)) {
      // console.log(strItem)
      let ast = parse(strItem[1])
      let data = {
        oldValue: strItem[1],
      }
      traverse.default(ast, {
        Identifier(path: any) {
          console.log(path.node.name)
          // 需要处理【xxx】的前缀
          if (!path.parent.property || path.key === 'object') {
            let name = path.node.name;
            mixinRender && mixinRender.mixinAdvance(name)
            if (mixinRender && mixinRender.reactiveMap.has(name)) {
              interpolationList.push({
                ...data,
                ast,
                path,
                replaceData:{value:'',prefix: mixinRender.reactiveMap.get(name).name}
              })
            }
            if (dataRender && dataRender.hasReactiveKey(name)) {
              interpolationList.push({
                ...data,
                ast,
                path,
                replaceData:{value:'',prefix: dataRender.options.dataName}
              })
            }
            if(vuexRender && vuexRender.stateHookMap.has(name)){
              interpolationList.push({
                ...data,
                ast,
                path,
                replaceData:vuexRender.stateHookMap.get(name)
              })
            }
          }
        }
      })
    }
  
    interpolationList.forEach((value) => {
      addPrefixIdentifier(value.path, value.replaceData)
    })
    RenderCallbacks.push(async () => {
      const callback = async(item:any) => {
        let value = await generate.default(item.ast);
        let code = removeAdapterVal(value.code)
        elem.data =elem.data.replaceAll(item.oldValue,code);
      }
     await  Promise.all(interpolationList.map(callback))
    })
  }

  const replaceAttribsVal = (attribs: any, key: string) => {
    let code = attribs[key];
    if (!code) return
    let ast = null;
    if (code.charAt(0) === '{' && code.charAt(code.length - 1) === '}') {
      code = `${adapterVariable}${code}`
    }
    ast = parse(code,)
    const nodeIdentifier: Array<any> = [];
    traverse.default(ast, {
      Identifier(path: any) {
        if (!path.parent.property || path.key === 'object') {
          let name = path.node.name;
          mixinRender && mixinRender.mixinAdvance(name)
          if (dataRender && dataRender.hasReactiveKey(name)) {
            nodeIdentifier.push({
              path,
              replaceData:{value:'',prefix: dataRender.options.dataName}
            })
          }
          if (mixinRender && mixinRender.reactiveMap.has(name)) {
            nodeIdentifier.push({
              path,
              replaceData:{value:'',prefix: mixinRender.reactiveMap.get(name).name}
            })
          }
          if(vuexRender && vuexRender.stateHookMap.has(name)){
            nodeIdentifier.push({
              path,
              replaceData: vuexRender.stateHookMap.get(name)
            })
          }
        }
      }
    })
    nodeIdentifier.forEach(pathItem => {
      addPrefixIdentifier(pathItem.path, pathItem.replaceData)
    })
    RenderCallbacks.push(async () => {
      let attribsCode = await generate.default(ast);

      attribs[key] = removeAdapterVal(attribsCode.code);
    })
  }

  const replaceInterpolation = (elem:any) => {
    if (elem.type === 'text') {
      loopInterpolation(elem)
    }
  }

  const updateRefName =(attribs:any,key:string) =>{
    if(key === 'ref') attribs[key] = getRefName(attribs[key])
  }

  const updateKey = (elem:any) =>{
    const attribs = elem.attribs;
    if(attribs && attribs[':key']){
      if(!attribs['v-for']){
        delete  attribs[':key'];
      }
    }
  }

  const addForKey = (elem:any) =>{
    const attribs = elem.attribs;
    if(attribs && attribs['v-for']){
        if(!attribs[':key']){
          let data = attribs['v-for'];
          let arr = data.substring(data.indexOf('(')+1,data.indexOf(')')).split(',');
          if(arr.length === 2) elem.attribs[':Key']= arr[1]
        }
    }
  }

  const updateSlot =(elem:any) =>{
    const attribs = elem.attribs;
    if(attribs && (attribs['slot'] || attribs['v-slot'])){
      elem.name = 'template';
      let slotName =  attribs['slot'] || attribs['v-slot']
      attribs[`#${slotName}`] = ''
      attribs['slot'] && delete attribs['slot'];
      attribs['v-slot'] && delete attribs['v-slot'];
    }
  }

  const dealWithAttribs = async (attribs: any) => {
    Object.keys(attribs).map(key => {
      updateRefName(attribs,key)
      let firstChar = key.charAt(0);
      if (key.indexOf('v-')>-1 || firstChar === ':' || firstChar==='@') replaceAttribsVal(attribs, key);
    })
  }
  if (scriptData && dom) {
    DomUtils.filter((elem: any) => {
      updateKey(elem)
      addForKey(elem)
      updateSlot(elem)
      const attribs = elem.attribs;
      attribs && dealWithAttribs(attribs)
      replaceInterpolation(elem) 
    }, dom, true)
    await Promise.all(RenderCallbacks.map(callback => callback()))
  }
}