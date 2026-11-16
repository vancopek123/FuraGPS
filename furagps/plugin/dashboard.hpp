#pragma once
#include <algorithm>
#include <limits>
#include <type_traits>

template<class T> struct Reading { T value{}; bool valid=false; };
static Reading<float> rpm,rangeKm,cruise,consumption,satisfaction;
static Reading<scs_u32_t> gameMinutes;
static Reading<scs_s32_t> multiplayerOffset;
static Reading<scs_u32_t> retarder;
static Reading<bool> parking;
static Reading<scs_value_fvector_t> acceleration;
static float peakX=0,peakY=0,peakZ=0,peakG=0;
static bool accelerationPeakValid=false;
static void reset_acceleration_peak(){peakX=peakY=peakZ=peakG=0;accelerationPeakValid=false;}
static void capture_acceleration_peak(){
    if(paused||!positionValid||!acceleration.valid){reset_acceleration_peak();return;}
    accelerationPeakValid=true;peakX=std::max(peakX,std::abs(acceleration.value.x));peakY=std::max(peakY,std::abs(acceleration.value.y));peakZ=std::max(peakZ,std::abs(acceleration.value.z));
    peakG=std::max(peakG,std::hypot(acceleration.value.x,acceleration.value.z)/9.80665f);
}
static bool navDistanceValid=false,navTimeValid=false,busActive=false;
static Reading<scs_u32_t> plannedArrival,actualArrival,stageIndex,stageCount;
static std::string nextStopId,nextStopName,busAttributes="[]",lastBusEvent;
static bool busAttributesTruncated=false;

static std::string clipped(const char* value,size_t max){
    if(!value)return "";std::string s(value);size_t n=std::min(max,s.size());
    while(n<s.size()&&n>0&&((unsigned char)s[n]&0xc0)==0x80)--n;return s.substr(0,n);
}
static std::string quote(const std::string& value){return "\""+escape(value)+"\"";}
template<class T> static std::string number(const Reading<T>& r,double factor=1){
    if(!r.valid||!std::isfinite((double)r.value))return "null";if constexpr(std::is_integral_v<T>)return std::to_string(r.value);char b[64];snprintf(b,sizeof(b),"%.7g",(double)r.value*factor);return b;
}
static std::string boolean(const Reading<bool>& r){return !r.valid?"null":r.value?"true":"false";}
SCSAPI_VOID extra_float(const scs_string_t,const scs_u32_t,const scs_value_t* const v,const scs_context_t c){auto& r=*(Reading<float>*)c;r.valid=v&&v->type==SCS_VALUE_TYPE_float&&std::isfinite(v->value_float.value);if(r.valid)r.value=v->value_float.value;}
SCSAPI_VOID extra_u32(const scs_string_t,const scs_u32_t,const scs_value_t* const v,const scs_context_t c){auto& r=*(Reading<scs_u32_t>*)c;r.valid=v&&v->type==SCS_VALUE_TYPE_u32;if(r.valid)r.value=v->value_u32.value;}
SCSAPI_VOID extra_s32(const scs_string_t,const scs_u32_t,const scs_value_t* const v,const scs_context_t c){auto& r=*(Reading<scs_s32_t>*)c;r.valid=v&&v->type==SCS_VALUE_TYPE_s32;if(r.valid)r.value=v->value_s32.value;}
SCSAPI_VOID extra_bool(const scs_string_t,const scs_u32_t,const scs_value_t* const v,const scs_context_t c){auto& r=*(Reading<bool>*)c;r.valid=v&&v->type==SCS_VALUE_TYPE_bool;if(r.valid)r.value=v->value_bool.value!=0;}
SCSAPI_VOID extra_vector(const scs_string_t,const scs_u32_t,const scs_value_t* const v,const scs_context_t){acceleration.valid=v&&v->type==SCS_VALUE_TYPE_fvector&&std::isfinite(v->value_fvector.x)&&std::isfinite(v->value_fvector.y)&&std::isfinite(v->value_fvector.z);if(acceleration.valid)acceleration.value=v->value_fvector;else reset_acceleration_peak();}
static const scs_named_value_t* bus_attribute(const scs_named_value_t* attrs,const char* name){
    if(!attrs)return nullptr;const scs_named_value_t* indexed=nullptr;
    for(int i=0;i<256&&attrs[i].name;i++)if(!strcmp(attrs[i].name,name)){
        if(attrs[i].index==SCS_U32_NIL)return attrs+i;
        if(stageIndex.valid&&attrs[i].index==stageIndex.value)indexed=attrs+i;
    }return indexed;
}
static Reading<scs_u32_t> bus_number(const scs_named_value_t* attrs,const char* name){auto a=bus_attribute(attrs,name);if(a&&a->value.type==SCS_VALUE_TYPE_u32)return {a->value.value_u32.value,true};return {};}
static std::string bus_string(const scs_named_value_t* attrs,const char* name){auto a=bus_attribute(attrs,name);return a&&a->value.type==SCS_VALUE_TYPE_string?clipped(a->value.value_string.value,160):"";}
static std::string raw_attributes(const scs_named_value_t* attrs){
    std::string out="[";int count=0;busAttributesTruncated=false;
    for(int i=0;attrs&&i<256&&attrs[i].name;i++){
        const auto& v=attrs[i].value;std::string value;char b[80];
        switch(v.type){
            case SCS_VALUE_TYPE_string:value=quote(clipped(v.value_string.value,120));break;
            case SCS_VALUE_TYPE_u32:snprintf(b,sizeof(b),"%u",v.value_u32.value);value=b;break;
            case SCS_VALUE_TYPE_s32:snprintf(b,sizeof(b),"%d",v.value_s32.value);value=b;break;
            case SCS_VALUE_TYPE_u64:snprintf(b,sizeof(b),"%llu",(unsigned long long)v.value_u64.value);value=quote(b);break;
            case SCS_VALUE_TYPE_s64:snprintf(b,sizeof(b),"%lld",(long long)v.value_s64.value);value=quote(b);break;
            case SCS_VALUE_TYPE_float:if(!std::isfinite(v.value_float.value))continue;snprintf(b,sizeof(b),"%.7g",v.value_float.value);value=b;break;
            case SCS_VALUE_TYPE_double:if(!std::isfinite(v.value_double.value))continue;snprintf(b,sizeof(b),"%.12g",v.value_double.value);value=b;break;
            case SCS_VALUE_TYPE_bool:value=v.value_bool.value?"true":"false";break;
            default:continue;
        }
        std::string item="{\"name\":"+quote(clipped(attrs[i].name,80))+",\"index\":"+std::to_string(attrs[i].index)+",\"type\":"+std::to_string(v.type)+",\"value\":"+value+"}";
        if(count>=32||out.size()+item.size()>2800){busAttributesTruncated=true;break;}
        if(count++)out+=",";out+=item;
    }return out+"]";
}
static void bus_configuration(const scs_telemetry_configuration_t* cfg){
    busActive=cfg->attributes&&cfg->attributes[0].name;plannedArrival={};actualArrival={};stageIndex={};stageCount={};nextStopId.clear();nextStopName.clear();
    if(!busActive){busAttributes="[]";busAttributesTruncated=false;satisfaction.valid=false;lastBusEvent.clear();return;}
    stageCount=bus_number(cfg->attributes,"bus.stages.count");stageIndex=bus_number(cfg->attributes,"bus.stages.current");
    // Names found in the installed 1.62 executable. Bus attributes are not yet
    // documented by SDK 1.16, so the UI labels this schedule source experimental.
    plannedArrival=bus_number(cfg->attributes,"destination_stop.arrival_time.planned");
    actualArrival=bus_number(cfg->attributes,"destination_stop.arrival_time.actual");
    nextStopId=bus_string(cfg->attributes,"destination_stop.id");nextStopName=bus_string(cfg->attributes,"destination_stop.name");
    busAttributes=raw_attributes(cfg->attributes);
}
SCSAPI_VOID gameplay(const scs_event_t,const void* const info,const scs_context_t){auto event=(const scs_telemetry_gameplay_event_t*)info;if(event&&event->id&&(strstr(event->id,"bus")||(busActive&&!strncmp(event->id,"job.",4))))lastBusEvent=clipped(event->id,120);}
static std::string dashboard_json(){
    Reading<float> ax{acceleration.value.x,acceleration.valid},ay{acceleration.value.y,acceleration.valid},az{acceleration.value.z,acceleration.valid};
    Reading<float> px{peakX,accelerationPeakValid},py{peakY,accelerationPeakValid},pz{peakZ,accelerationPeakValid},pg{peakG,accelerationPeakValid};
    return ",\"pluginVersion\":\"0.11.0\",\"rpm\":"+number(rpm)+",\"fuelRange\":"+number(rangeKm)+",\"fuelConsumption\":"+number(consumption)+",\"cruiseSpeed\":"+number(cruise,3.6)+",\"parkingBrake\":"+boolean(parking)+",\"retarder\":"+number(retarder)+
      ",\"accelerationX\":"+number(ax)+",\"accelerationZ\":"+number(az)+",\"gameMinutes\":"+number(gameMinutes)+",\"multiplayerOffset\":"+number(multiplayerOffset)+",\"navigationValid\":"+(navTimeValid&&navDistanceValid?"true":"false")+
      ",\"accelerationY\":"+number(ay)+",\"accelerationPeakX\":"+number(px)+",\"accelerationPeakY\":"+number(py)+",\"accelerationPeakZ\":"+number(pz)+",\"accelerationPeakG\":"+number(pg)+
      ",\"bus\":{\"active\":"+(busActive?std::string("true"):std::string("false"))+",\"nextStopId\":"+quote(nextStopId)+",\"nextStopName\":"+quote(nextStopName)+",\"plannedArrival\":"+number(plannedArrival)+",\"actualArrival\":"+number(actualArrival)+",\"stage\":"+number(stageIndex)+",\"stages\":"+number(stageCount)+",\"satisfaction\":"+number(satisfaction)+",\"attributes\":"+busAttributes+",\"attributesTruncated\":"+(busAttributesTruncated?"true":"false")+",\"lastEvent\":"+quote(lastBusEvent)+"}";
}
static void register_dashboard(const scs_telemetry_init_params_v100_t* p){
    const auto flag=SCS_TELEMETRY_CHANNEL_FLAG_no_value;
    struct F {const char* name;Reading<float>* value;};
    for(auto c: {F{"truck.engine.rpm",&rpm},F{"truck.fuel.range",&rangeKm},F{"truck.fuel.consumption.average",&consumption},F{"truck.cruise_control",&cruise},F{"bus_job.average_satisfaction",&satisfaction}})p->register_for_channel(c.name,SCS_U32_NIL,SCS_VALUE_TYPE_float,flag,extra_float,c.value);
    p->register_for_channel("truck.local.acceleration.linear",SCS_U32_NIL,SCS_VALUE_TYPE_fvector,flag,extra_vector,nullptr);
    p->register_for_channel("game.time",SCS_U32_NIL,SCS_VALUE_TYPE_u32,flag,extra_u32,&gameMinutes);
    p->register_for_channel("multiplayer.time.offset",SCS_U32_NIL,SCS_VALUE_TYPE_s32,flag,extra_s32,&multiplayerOffset);
    p->register_for_channel("truck.brake.parking",SCS_U32_NIL,SCS_VALUE_TYPE_bool,flag,extra_bool,&parking);
    p->register_for_channel("truck.brake.retarder",SCS_U32_NIL,SCS_VALUE_TYPE_u32,flag,extra_u32,&retarder);
    p->register_for_event(SCS_TELEMETRY_EVENT_gameplay,gameplay,nullptr);
}
