
export function dropfromArray(arr,e){
    for(let i=0; i < arr.length; i++){
        if (arr[i]==e){
            arr.splice(i,1)
            i-- //Just in case the element is in the list more than once
        }
    }
    return arr
}